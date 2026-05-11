// `envstore sync` — bring envstore.json in line with the filesystem.
//
// Walks the repo looking for .env files (same logic as `envstore init`),
// diffs against the configured `files[]` array, and offers to register new
// ones / drop missing ones. Idempotent — safe to run any time.
//
// Flags:
//   --dry-run / -n   show the diff without writing anything
//   --yes / -y       accept every suggested addition without prompting
//   --add-only       skip the "missing on disk" pass
//   --remove-only    skip the "new on disk" pass
//   --prune          when combined with --yes, also remove missing entries
//                    (off by default — running --yes shouldn't silently
//                    delete config entries based on a working-tree state)

import { dirname, resolve } from 'node:path';
import { stat } from 'node:fs/promises';

import {
  isMultiConfig,
  renderEnvstoreConfig,
  slugify,
  validateSlug,
  type EnvstoreFileEntry,
} from '@envstore/shared';

import { makeClient } from '../lib/api';
import type { Args } from '../lib/args';
import {
  findProjectConfig,
  resolveApiUrl,
  writeProjectConfig,
} from '../lib/config';
import { CliError } from '../lib/errors';
import { scanEnvFiles, suggestProjectSlugForFile } from '../lib/monorepo';
import { c, info, muted, success } from '../lib/output';
import { askConfirm, askText, requireTty } from '../lib/prompt';

type ProjectSummary = { slug: string; name: string };

export async function sync(args: Args): Promise<void> {
  const cwd = process.cwd();
  const cfg = await findProjectConfig(cwd);
  if (!cfg) {
    throw new CliError('No envstore.json found here or in any parent directory.', {
      hint: 'Run `envstore init` first.',
    });
  }
  if (!isMultiConfig(cfg.config)) {
    throw new CliError(
      '`envstore sync` only works with multi-file configs (the `files[]` shape).',
      {
        hint:
          'You\'re on the legacy single-project config. Re-run `envstore init --force` ' +
          'in your monorepo root to switch to the multi shape.',
      },
    );
  }

  const dryRun = Boolean(args.flags['dry-run'] || args.flags['n']);
  const yes = Boolean(args.flags['yes'] || args.flags['y']);
  const addOnly = Boolean(args.flags['add-only']);
  const removeOnly = Boolean(args.flags['remove-only']);
  const prune = Boolean(args.flags['prune']);

  const configDir = dirname(cfg.path);
  const apiUrl = await resolveApiUrl({ project: cfg.config });
  const workspace = cfg.config.workspace;

  // ----- Scan + diff -----
  const onDisk = await scanEnvFiles(configDir);
  const inConfig = new Set(cfg.config.files.map((f) => f.path));

  const added = removeOnly ? [] : onDisk.filter((p) => !inConfig.has(p));
  const removed: EnvstoreFileEntry[] = [];
  if (!addOnly) {
    for (const entry of cfg.config.files) {
      const exists = await pathExists(resolve(configDir, entry.path));
      if (!exists) removed.push(entry);
    }
  }

  if (added.length === 0 && removed.length === 0) {
    success('Already in sync. No changes.');
    return;
  }

  // ----- Show diff -----
  if (added.length > 0) {
    info(c.green(`+ ${added.length} new file${added.length === 1 ? '' : 's'} found:`));
    for (const p of added) console.log(`    ${c.gray(p)}`);
  }
  if (removed.length > 0) {
    info(
      c.yellow(
        `- ${removed.length} entr${removed.length === 1 ? 'y is' : 'ies are'} missing on disk:`,
      ),
    );
    for (const r of removed) console.log(`    ${c.gray(r.path)} ${c.gray(`(${r.project})`)}`);
  }
  console.log();

  if (dryRun) {
    muted('--dry-run: not writing changes.');
    return;
  }

  // ----- Resolve added files -----
  const newEntries: EnvstoreFileEntry[] = [];
  if (added.length > 0) {
    if (!yes) requireTty();
    const client = makeClient(apiUrl);
    let projects: ProjectSummary[] = await client.get<ProjectSummary[]>(
      `/api/v1/workspaces/${workspace}/projects`,
    );

    for (const filePath of added) {
      const suggestion = slugify(await suggestProjectSlugForFile(configDir, filePath));
      const projectSlug = yes
        ? suggestion || 'project'
        : (() => {
            console.log();
            info(`${c.cyan(filePath)}`);
            return askText('  Project slug', {
              default: suggestion || 'project',
              required: true,
              validate: (v) => {
                const r = validateSlug(v);
                return r.ok ? null : r.reason;
              },
            });
          })();

      if (!projects.some((p) => p.slug === projectSlug)) {
        // Create the project on the server. Use the slug as the display name —
        // the user can rename in the dashboard.
        const created = await client.post<ProjectSummary>(
          `/api/v1/workspaces/${workspace}/projects`,
          { slug: projectSlug, name: projectSlug },
        );
        projects = [...projects, created];
        info(`  ${c.gray('created project')} ${c.cyan(created.slug)}`);
      }
      newEntries.push({ path: filePath, project: projectSlug });
    }
  }

  // ----- Confirm removals -----
  const toRemove: Set<string> = new Set();
  if (removed.length > 0) {
    if (yes && !prune) {
      // Conservative: --yes alone never deletes config entries based on
      // working-tree state. The user needs --prune to opt in.
      muted(
        '(skipping removals — pass `--prune` with `--yes` to drop missing entries automatically)',
      );
    } else {
      for (const entry of removed) {
        const ok = yes && prune
          ? true
          : askConfirm(`Drop ${c.cyan(entry.path)} from envstore.json?`, false);
        if (ok) toRemove.add(entry.path);
      }
    }
  }

  // ----- Compose updated config -----
  const finalFiles: EnvstoreFileEntry[] = [
    ...cfg.config.files.filter((f) => !toRemove.has(f.path)),
    ...newEntries,
  ];
  const content = renderEnvstoreConfig({
    workspace: cfg.config.workspace,
    files: finalFiles,
    schemaUrl: cfg.config.$schema,
    apiUrl: cfg.config.apiUrl,
  });
  await writeProjectConfig(cfg.path, content);

  console.log();
  const addedCount = newEntries.length;
  const removedCount = toRemove.size;
  success(
    `Synced. ${plural(addedCount, 'file added')}, ${plural(removedCount, 'file removed')}.`,
  );
  if (addedCount > 0 || removedCount > 0) {
    muted(`${cfg.path}`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function plural(n: number, singular: string): string {
  const pluralForm = singular.endsWith('s') ? singular : `${singular}s`;
  return `${n} ${n === 1 ? singular : pluralForm}`;
}
