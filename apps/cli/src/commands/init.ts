// `envstore init` — interactive setup that creates a workspace and/or project
// on the server, then writes envstore.json in cwd.
//
// Behavior:
//   - Auto-picks the only workspace if you have exactly one (skip the prompt).
//   - If the workspace has no projects yet, jumps straight to "create project".
//   - Pre-fills name + slug from package.json `name` field when available.
//   - Detects monorepos (pnpm-workspace.yaml / package.json#workspaces /
//     turbo.json), scans every .env-style file, and offers to set them all up
//     in one go as a multi-file envstore.json.
//
// Flags:
//   --workspace <slug>   skip workspace selection; create if doesn't exist
//   --project <slug>     skip project selection; create if doesn't exist
//   --name <text>        explicit display name for new resources
//   --force              overwrite existing envstore.json
//   --single             force the single-project flow even in a detected monorepo

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ENVSTORE_CONFIG_FILENAME,
  renderEnvstoreConfig,
  slugify,
  validateSlug,
  validateWorkspaceSlug,
  type EnvstoreFileEntry,
} from '@envstore/shared';

import { makeClient } from '../lib/api';
import type { Args } from '../lib/args';
import { findProjectConfig, resolveApiUrl, writeProjectConfig } from '../lib/config';
import { CliError } from '../lib/errors';
import {
  describeMarkers,
  detectMonorepoMarkers,
  hasAnyMonorepoMarker,
  scanEnvFiles,
  suggestEnvSlugForFile,
} from '../lib/monorepo';
import { c, info, muted, success } from '../lib/output';
import { askChoice, askConfirm, askText, requireTty } from '../lib/prompt';
import type { MeResponse, MeWorkspace } from '../lib/me';

type ProjectSummary = { slug: string; name: string };
type ProjectSuggestion = { name: string; slug: string; source: string };

export async function init(args: Args): Promise<void> {
  const cwd = process.cwd();
  const existing = await findProjectConfig(cwd);
  if (existing && existing.path === join(cwd, ENVSTORE_CONFIG_FILENAME) && !args.flags['force']) {
    throw new CliError(`${ENVSTORE_CONFIG_FILENAME} already exists in ${cwd}.`, {
      hint: 'Pass --force to overwrite, or use `envstore link` for a different project.',
    });
  }

  const apiUrl = await resolveApiUrl();
  const client = makeClient(apiUrl);
  const me = await client.get<MeResponse>('/api/v1/me');

  // Monorepo detection: any of the three common markers + multiple env files.
  // --single bypasses entirely, so users with an unusual layout can still
  // fall through to the per-directory flow.
  if (!args.flags['single']) {
    const markers = await detectMonorepoMarkers(cwd);
    if (hasAnyMonorepoMarker(markers)) {
      const envFiles = await scanEnvFiles(cwd);
      if (envFiles.length >= 2) {
        const proceeded = await maybeInitMonorepo({
          client,
          me,
          cwd,
          apiUrl,
          markers: describeMarkers(markers),
          envFiles,
          args,
        });
        if (proceeded) return;
        // User declined → fall through to single-project flow.
      }
    }
  }

  const suggestion = await suggestFromPackageJson(cwd);

  // ----- Workspace -----
  const workspace = await resolveWorkspace(client, me, stringFlag(args.flags['workspace']), args);

  // ----- Project -----
  const projects = await client.get<ProjectSummary[]>(
    `/api/v1/workspaces/${workspace.slug}/projects`,
  );
  const project = await resolveProject(
    client,
    workspace.slug,
    projects,
    stringFlag(args.flags['project']),
    stringFlag(args.flags['name']),
    suggestion,
  );

  // ----- Write envstore.json -----
  const target = join(cwd, ENVSTORE_CONFIG_FILENAME);
  const content = renderEnvstoreConfig({
    workspace: workspace.slug,
    project: project.slug,
    schemaUrl: `${apiUrl}/schema/envstore.json`,
  });
  await writeProjectConfig(target, content);

  console.log();
  success(`Wrote ${ENVSTORE_CONFIG_FILENAME}.`);
  console.log(`  ${c.gray('workspace:')} ${c.cyan(workspace.slug)}`);
  console.log(`  ${c.gray('project:')}   ${c.cyan(project.slug)}`);
  console.log();
  muted('Commit this file. It contains no secrets — just routing info.');
  muted(`Next: \`envstore identity init\` (if you haven't yet), then \`envstore push .env\`.`);
}

// =============================================================================
// Monorepo init flow
// =============================================================================

// Walks the user through registering every env file in a monorepo under a
// single envstore project. Each file becomes its own environment within that
// one project (e.g. .env→root, apps/web/.env.local→web). This matches the
// "the monorepo is the deployable unit" mental model — one envstore project
// per repo, environments per workspace dir. Returns true if it wrote a
// config (user proceeded), false if they declined.
async function maybeInitMonorepo(opts: {
  client: ReturnType<typeof makeClient>;
  me: MeResponse;
  cwd: string;
  apiUrl: string;
  markers: string;
  envFiles: string[];
  args: Args;
}): Promise<boolean> {
  const { client, me, cwd, apiUrl, markers, envFiles, args } = opts;
  requireTty();
  info(`Detected monorepo (${markers}).`);
  info(`Found ${envFiles.length} env files:`);
  for (const f of envFiles) console.log(`  ${c.gray(f)}`);
  console.log();
  if (!askConfirm('Set them all up in one envstore project (each file → its own environment)?', true)) {
    return false;
  }

  // Resolve workspace + project ONCE for all files.
  const workspace = await resolveWorkspace(
    client,
    me,
    stringFlag(args.flags['workspace']),
    args,
  );

  const projects = await client.get<ProjectSummary[]>(
    `/api/v1/workspaces/${workspace.slug}/projects`,
  );
  const suggestion = await suggestFromPackageJson(cwd);
  const project = await resolveProject(
    client,
    workspace.slug,
    projects,
    stringFlag(args.flags['project']),
    stringFlag(args.flags['name']),
    suggestion,
  );

  // For each file, prompt for an environment slug. Suggestion comes from the
  // file's location (apps/web/.env.local → "web", root .env → "root",
  // .env.production → "production").
  console.log();
  info(c.gray('Pick an environment name for each file:'));
  const entries: EnvstoreFileEntry[] = [];
  const usedSlugs = new Set<string>();
  for (const filePath of envFiles) {
    const raw = suggestEnvSlugForFile(filePath);
    let defaultSlug = slugify(raw) || 'root';
    // Avoid collisions inside this single project — append a -N suffix if the
    // suggested slug was already used by an earlier file.
    if (usedSlugs.has(defaultSlug)) {
      let i = 2;
      while (usedSlugs.has(`${defaultSlug}-${i}`)) i++;
      defaultSlug = `${defaultSlug}-${i}`;
    }
    console.log();
    info(`${c.cyan(filePath)}`);
    const envSlug = askText('  Environment slug', {
      default: defaultSlug,
      required: true,
      validate: (v) => {
        const r = validateSlug(v);
        if (!r.ok) return r.reason;
        if (usedSlugs.has(v)) {
          return `"${v}" already used by another file in this config — pick a distinct slug.`;
        }
        return null;
      },
    });
    usedSlugs.add(envSlug);
    entries.push({ path: filePath, project: project.slug, environment: envSlug });
  }

  // ----- Write the multi-config envstore.json -----
  const target = join(cwd, ENVSTORE_CONFIG_FILENAME);
  const content = renderEnvstoreConfig({
    workspace: workspace.slug,
    files: entries,
    schemaUrl: `${apiUrl}/schema/envstore.json`,
  });
  await writeProjectConfig(target, content);

  console.log();
  success(`Wrote ${ENVSTORE_CONFIG_FILENAME} (${entries.length} files → 1 project).`);
  console.log(`  ${c.gray('workspace:')} ${c.cyan(workspace.slug)}`);
  console.log(`  ${c.gray('project:  ')} ${c.cyan(project.slug)}`);
  for (const e of entries) {
    console.log(`  ${c.cyan(e.path)} → ${c.gray(e.environment ?? '?')}`);
  }
  console.log();
  muted('Commit this file. It contains no secrets — just routing info.');
  muted('Next: `envstore identity init` (if you haven\'t yet), then `envstore push` to upload all of them.');
  return true;
}

// =============================================================================
// Workspace resolution
// =============================================================================

async function resolveWorkspace(
  client: ReturnType<typeof makeClient>,
  me: MeResponse,
  wsFlag: string | undefined,
  args: Args,
): Promise<MeWorkspace> {
  // --workspace foo: use it if exists, otherwise create.
  if (wsFlag) {
    const existing = me.workspaces.find((w) => w.slug === wsFlag);
    if (existing) return existing;
    return createWorkspace(client, wsFlag, stringFlag(args.flags['name']));
  }

  // Zero workspaces is rare — `ensurePersonalWorkspace` creates one on first sign-in.
  if (me.workspaces.length === 0) {
    requireTty();
    info("You don't have any workspaces yet. Let's create one.");
    return createWorkspaceInteractive(client);
  }

  // Exactly one workspace: don't make the user click through a single-option menu.
  if (me.workspaces.length === 1) {
    const only = me.workspaces[0]!;
    muted(`Using your only workspace: ${c.cyan(only.slug)}`);
    return only;
  }

  requireTty();
  return pickOrCreateWorkspace(client, me);
}

async function pickOrCreateWorkspace(
  client: ReturnType<typeof makeClient>,
  me: MeResponse,
): Promise<MeWorkspace> {
  type Choice = 'CREATE' | string;
  const choice = askChoice<Choice>('Pick a workspace:', [
    ...me.workspaces.map((w) => ({
      value: w.slug,
      label: `${w.name} (${w.slug})`,
      hint: w.type.toLowerCase(),
    })),
    { value: 'CREATE', label: '+ Create new team workspace' },
  ]);
  if (choice !== 'CREATE') {
    return me.workspaces.find((w) => w.slug === choice)!;
  }
  return createWorkspaceInteractive(client);
}

async function createWorkspaceInteractive(
  client: ReturnType<typeof makeClient>,
): Promise<MeWorkspace> {
  const name = askText('Workspace name', { required: true });
  const slug = askText('Workspace slug', {
    default: slugify(name),
    required: true,
    validate: (v) => {
      const r = validateWorkspaceSlug(v);
      return r.ok ? null : r.reason;
    },
  });
  return createWorkspace(client, slug, name);
}

async function createWorkspace(
  client: ReturnType<typeof makeClient>,
  slug: string,
  name: string | undefined,
): Promise<MeWorkspace> {
  const created = await client.post<MeWorkspace>('/api/v1/workspaces', {
    slug,
    name: name ?? slug,
  });
  success(`Created workspace ${created.slug}.`);
  return created;
}

// =============================================================================
// Project resolution
// =============================================================================

async function resolveProject(
  client: ReturnType<typeof makeClient>,
  workspaceSlug: string,
  projects: ProjectSummary[],
  projFlag: string | undefined,
  nameFlag: string | undefined,
  suggestion: ProjectSuggestion | null,
): Promise<ProjectSummary> {
  if (projFlag) {
    const existing = projects.find((p) => p.slug === projFlag);
    if (existing) return existing;
    return createProject(client, workspaceSlug, projFlag, nameFlag ?? suggestion?.name ?? projFlag);
  }

  // No projects: skip the picker, go straight to create with the suggestion.
  if (projects.length === 0) {
    requireTty();
    info(`No projects in ${c.cyan(workspaceSlug)} yet — let's create one.`);
    if (suggestion) {
      muted(`(detected ${suggestion.source}: ${c.cyan(suggestion.name)} → slug ${c.cyan(suggestion.slug)})`);
    }
    return createProjectInteractive(client, workspaceSlug, suggestion);
  }

  requireTty();
  return pickOrCreateProject(client, workspaceSlug, projects, suggestion);
}

async function pickOrCreateProject(
  client: ReturnType<typeof makeClient>,
  workspaceSlug: string,
  projects: ProjectSummary[],
  suggestion: ProjectSuggestion | null,
): Promise<ProjectSummary> {
  const createLabel = suggestion
    ? `+ Create new project (${suggestion.name})`
    : '+ Create new project';
  const choice = askChoice<string>('Pick a project:', [
    ...projects.map((p) => ({ value: p.slug, label: `${p.name} (${p.slug})` })),
    { value: 'CREATE', label: createLabel, hint: suggestion?.source },
  ]);
  if (choice !== 'CREATE') {
    return projects.find((p) => p.slug === choice)!;
  }
  return createProjectInteractive(client, workspaceSlug, suggestion);
}

async function createProjectInteractive(
  client: ReturnType<typeof makeClient>,
  workspaceSlug: string,
  suggestion: ProjectSuggestion | null,
): Promise<ProjectSummary> {
  const name = askText('Project name', { default: suggestion?.name, required: true });
  const slug = askText('Project slug', {
    default: suggestion?.slug && suggestion.name === name ? suggestion.slug : slugify(name),
    required: true,
    validate: (v) => {
      const r = validateSlug(v);
      return r.ok ? null : r.reason;
    },
  });
  const ok = askConfirm(`Create project "${name}" (${slug}) in ${workspaceSlug}?`, true);
  if (!ok) throw new CliError('Cancelled.');
  return createProject(client, workspaceSlug, slug, name);
}

async function createProject(
  client: ReturnType<typeof makeClient>,
  workspaceSlug: string,
  slug: string,
  name: string,
): Promise<ProjectSummary> {
  const created = await client.post<ProjectSummary>(
    `/api/v1/workspaces/${workspaceSlug}/projects`,
    { slug, name },
  );
  success(`Created project ${workspaceSlug}/${created.slug}.`);
  return created;
}

// =============================================================================
// Suggestions from local files
// =============================================================================

async function suggestFromPackageJson(cwd: string): Promise<ProjectSuggestion | null> {
  try {
    const raw = await readFile(join(cwd, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as { name?: unknown };
    if (typeof pkg.name !== 'string' || !pkg.name.trim()) return null;
    // Strip scope: "@org/foo" → "foo".
    const bare = pkg.name.includes('/') ? pkg.name.split('/').pop()! : pkg.name;
    const slug = slugify(bare);
    if (!slug) return null;
    return { name: bare, slug, source: 'package.json' };
  } catch {
    return null;
  }
}

function stringFlag(v: string | true | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
