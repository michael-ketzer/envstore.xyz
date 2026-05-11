// Monorepo detection + .env file scanning for `envstore init`.
//
// "Monorepo" here just means: the cwd contains a marker that says workspaces
// live below it. We check the three common ones (pnpm, npm/yarn, turbo). The
// presence is enough — we don't parse globs, we just walk the FS for env
// files. Reliable across exotic layouts (lerna, nx, custom).

import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';

// Directories we never want to descend into when scanning a monorepo.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.turbo',
  '.vercel',
  '.nuxt',
  '.svelte-kit',
  '.cache',
  '.parcel-cache',
  'dist',
  'build',
  'out',
  'coverage',
  '.expo',
  'target',
]);

// Files we treat as "real" env files. We deliberately skip templates and
// example files — those are committed and don't hold secrets.
function isEnvFilename(name: string): boolean {
  if (!name.startsWith('.env')) return false;
  if (name.endsWith('.example') || name.endsWith('.sample') || name.endsWith('.template')) {
    return false;
  }
  // Reject backup-style files like `.env.bak`, `.env~`.
  if (name.endsWith('.bak') || name.endsWith('~')) return false;
  return true;
}

export type MonorepoMarkers = {
  pnpmWorkspace: boolean;
  packageJsonWorkspaces: boolean;
  turbo: boolean;
};

// Returns the markers detected at `cwd`. The caller decides what counts as
// "monorepo enough" — generally any one of the three is sufficient.
export async function detectMonorepoMarkers(cwd: string): Promise<MonorepoMarkers> {
  const [pnpmWorkspace, turbo, packageJsonWorkspaces] = await Promise.all([
    fileExists(join(cwd, 'pnpm-workspace.yaml')),
    fileExists(join(cwd, 'turbo.json')),
    packageJsonHasWorkspaces(cwd),
  ]);
  return { pnpmWorkspace, packageJsonWorkspaces, turbo };
}

export function hasAnyMonorepoMarker(m: MonorepoMarkers): boolean {
  return m.pnpmWorkspace || m.packageJsonWorkspaces || m.turbo;
}

// Pretty-print the detected markers for the user.
export function describeMarkers(m: MonorepoMarkers): string {
  const parts: string[] = [];
  if (m.pnpmWorkspace) parts.push('pnpm-workspace.yaml');
  if (m.packageJsonWorkspaces) parts.push('package.json#workspaces');
  if (m.turbo) parts.push('turbo.json');
  return parts.join(', ');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function packageJsonHasWorkspaces(cwd: string): Promise<boolean> {
  try {
    const raw = await readFile(join(cwd, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { workspaces?: unknown };
    return Array.isArray(pkg.workspaces) || typeof pkg.workspaces === 'object';
  } catch {
    return false;
  }
}

// Walk the directory tree from `root`, returning every .env-like file's path
// relative to `root`. Skips well-known noise dirs and stops at depth 5
// (deep enough for apps/<name>/.env.local without going wild).
//
// Symlinks: a common monorepo pattern is to symlink a shared `.env` into a
// sub-package (e.g. `packages/database/.env -> ../../.env` so Prisma finds
// it). We resolve symlinks and dedupe by the real path, keeping the
// shortest relative path. That stops us from registering the same physical
// file under two project entries.
export async function scanEnvFiles(
  root: string,
  opts: { maxDepth?: number } = {},
): Promise<string[]> {
  const maxDepth = opts.maxDepth ?? 5;
  const byRealPath = new Map<string, string>(); // realpath → shortest relpath seen

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        // Skip hidden dirs (.git, .next, etc.) — already covered by SKIP_DIRS
        // for the well-known ones, but be defensive about anything else.
        if (entry.name.startsWith('.')) continue;
        await walk(fullPath, depth + 1);
        continue;
      }
      // Treat both regular files and symlinks-to-files as candidates. The
      // initial entry filter is just the basename; we then `stat` (which
      // follows symlinks) to confirm it's actually a file.
      if (!isEnvFilename(entry.name)) continue;
      try {
        const s = await stat(fullPath);
        if (!s.isFile()) continue;
        const real = await realpath(fullPath);
        const rel = relative(root, fullPath);
        const existing = byRealPath.get(real);
        if (!existing || rel.length < existing.length) {
          byRealPath.set(real, rel);
        }
      } catch {
        // Broken symlink / permission error — skip silently.
      }
    }
  }

  await walk(root, 0);
  const found = Array.from(byRealPath.values());
  // Sort: root-level first, then alphabetical for deterministic output.
  found.sort((a, b) => {
    const ad = a.includes('/') ? 1 : 0;
    const bd = b.includes('/') ? 1 : 0;
    if (ad !== bd) return ad - bd;
    return a.localeCompare(b);
  });
  return found;
}

// Pick a reasonable default project slug for an env file's location:
//   1. The directory's own package.json `name` field (scoped names stripped).
//   2. Failing that, the directory's basename (e.g. `apps/web` → `web`).
//   3. For root-level files (cwd), the cwd's own basename.
export async function suggestProjectSlugForFile(
  root: string,
  relPath: string,
): Promise<string> {
  const fileAbs = join(root, relPath);
  const fileDir = dirname(fileAbs);

  const pkgName = await readPackageName(fileDir);
  if (pkgName) return pkgName;

  if (fileDir === root) {
    const rootPkgName = await readPackageName(root);
    if (rootPkgName) return rootPkgName;
    return basename(root);
  }

  return basename(fileDir);
}

async function readPackageName(dir: string): Promise<string | null> {
  try {
    const raw = await readFile(join(dir, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { name?: unknown };
    if (typeof pkg.name !== 'string' || !pkg.name.trim()) return null;
    // Strip npm scope: `@org/foo` → `foo`.
    return pkg.name.includes('/') ? pkg.name.split('/').pop()! : pkg.name;
  } catch {
    return null;
  }
}
