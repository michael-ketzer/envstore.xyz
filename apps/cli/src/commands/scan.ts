// `envstore scan` — find plaintext .env files tracked in git.
//
// Defends against the most common envstore-shaped accident: a teammate runs
// `git add .` and commits a real .env before noticing. Designed to be cheap
// enough to run in a pre-commit hook (`envstore scan --staged`).
//
// Rules:
//   - Look at the names of tracked / staged paths only — never read file
//     contents (no false-positive theatre, no surprise plaintext slurp).
//   - Match the dotenv family: `.env`, `.env.local`, `.env.production`, etc.
//   - Allowlist obvious template names so `.env.example` doesn't get flagged.
//   - Exit 1 if any matches found, so the command composes with `pre-commit`,
//     `husky`, and CI gates.

import { basename } from 'node:path';

import { CliError } from '../lib/errors';
import { c, info, success, warn } from '../lib/output';
import type { Args } from '../lib/args';

const SAFE_NAMES = new Set([
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env.dist',
  '.env.defaults',
]);

// `.env`, `.env.local`, `.env.production`, `.env.production.local` — names
// that almost always contain real secrets. We explicitly do NOT match
// `.envrc` (direnv config — not a secrets file).
const RISKY_NAME = /^\.env(\..+)?$/;

export async function scan(args: Args): Promise<void> {
  const staged = Boolean(args.flags['staged']);
  const paths = staged ? await stagedFiles() : await trackedFiles();

  const flagged = paths.filter((p) => isRiskyEnvFile(p)).sort();

  if (flagged.length === 0) {
    if (staged) {
      success('No risky .env files staged for commit.');
    } else {
      success('No tracked .env files look unsafe.');
    }
    return;
  }

  const scope = staged ? 'staged for commit' : 'tracked in git';
  warn(`Found ${flagged.length} plaintext .env file${flagged.length === 1 ? '' : 's'} ${scope}:`);
  for (const path of flagged) {
    info(`  ${c.red('✗')} ${path}`);
  }
  info('');
  info(`Move the secrets into envstore (${c.cyan('envstore push')}), then:`);
  info(`  ${c.gray('git rm --cached <file>')}    # untrack without deleting the local copy`);
  info(`  ${c.gray('echo <file> >> .gitignore')}`);
  info(`  ${c.gray('git commit -m "Untrack <file>"')}`);
  info('');
  info(`Names like ${c.cyan('.env.example')} are allowlisted — keep using those for templates.`);
  throw new CliError(`${flagged.length} risky file${flagged.length === 1 ? '' : 's'} found.`);
}

function isRiskyEnvFile(path: string): boolean {
  const base = basename(path);
  if (!RISKY_NAME.test(base)) return false;
  if (SAFE_NAMES.has(base)) return false;
  // `.env.example.local` etc. — uncommon, but if the user actually committed
  // a `.env.example` variant we should not yell about it. The simple rule: if
  // the basename contains `example`, `sample`, `template`, `dist`, or
  // `defaults` as a dot-segment, treat it as a template.
  const segments = base.split('.');
  for (const safe of ['example', 'sample', 'template', 'dist', 'defaults']) {
    if (segments.includes(safe)) return false;
  }
  return true;
}

async function trackedFiles(): Promise<string[]> {
  return await runGit(['ls-files']);
}

async function stagedFiles(): Promise<string[]> {
  // `--diff-filter=ACMR` covers Added / Copied / Modified / Renamed — we
  // care about anything that's going INTO the index, not deletions.
  return await runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
}

async function runGit(args: string[]): Promise<string[]> {
  const proc = Bun.spawn(['git', ...args], { stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) {
    if (stderr.includes('not a git repository')) {
      throw new CliError('Not inside a git repository.', {
        hint: 'envstore scan needs git to know what is tracked. Run inside a git working tree.',
      });
    }
    throw new CliError(`git ${args.join(' ')} failed (exit ${code}): ${stderr.trim()}`);
  }
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
