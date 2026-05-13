// `envstore versions [env]` — list the version history for an environment.
//
// Defaults: env = envstore.json's defaultEnv, then "development". For
// multi-config (monorepo) layouts, the user can also pass --project to
// disambiguate. The current-pointer row is marked so it's obvious which
// version `envstore pull` would return today.

import { isMultiConfig, validateSlug, type VersionListResponse } from '@envstore/shared';

import { makeClient } from '../lib/api';
import type { Args } from '../lib/args';
import { findProjectConfig, resolveApiUrl } from '../lib/config';
import { CliError } from '../lib/errors';
import { c, heading, muted } from '../lib/output';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function stringFlag(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export async function versions(args: Args): Promise<void> {
  const cfg = await findProjectConfig();
  if (!cfg) {
    throw new CliError('No envstore.json found here or in any parent directory.', {
      hint: 'Run `envstore init` in your project root, or `envstore link <CODE>`.',
    });
  }

  const apiUrl = await resolveApiUrl({ project: cfg.config });
  const client = makeClient(apiUrl);
  const { workspace } = cfg.config;

  // Resolve project + env. Flat config has one project; multi-config
  // requires --project unless the files list collapses to one. Env is
  // the first positional, then --env, then defaultEnv, then "development".
  let projectSlug: string;
  if (isMultiConfig(cfg.config)) {
    const projectFlag = stringFlag(args.flags['project']);
    if (projectFlag) {
      const ok = cfg.config.files.some((f) => f.project === projectFlag);
      if (!ok) {
        throw new CliError(
          `--project ${projectFlag} doesn't match any file in this envstore.json.`,
          {
            hint: `Configured: ${cfg.config.files.map((f) => f.project).join(', ')}`,
          },
        );
      }
      projectSlug = projectFlag;
    } else {
      const uniq = Array.from(new Set(cfg.config.files.map((f) => f.project)));
      if (uniq.length === 1) {
        projectSlug = uniq[0]!;
      } else {
        throw new CliError(
          'This envstore.json lists multiple projects. Pass --project <slug>.',
          { hint: `Configured projects: ${uniq.join(', ')}` },
        );
      }
    }
  } else {
    projectSlug = cfg.config.project;
  }

  const envArg = args.positional[0] ?? stringFlag(args.flags['env']);
  const envSlug =
    envArg ?? (!isMultiConfig(cfg.config) ? cfg.config.defaultEnv : undefined) ?? 'development';
  const slugCheck = validateSlug(envSlug);
  if (!slugCheck.ok) {
    throw new CliError(`Invalid environment slug "${envSlug}": ${slugCheck.reason}`);
  }

  const res = await client.get<VersionListResponse>(
    `/api/v1/workspaces/${workspace}/projects/${projectSlug}/environments/${envSlug}/versions`,
  );

  if (res.versions.length === 0) {
    muted(`${workspace}/${projectSlug}/${envSlug}: no versions yet.`);
    return;
  }

  heading(`${workspace}/${projectSlug}/${envSlug} — version history`);
  muted(
    `${res.versions.length} retained · workspace cap: ${res.versionHistoryLimit}`,
  );
  console.log();
  for (const v of res.versions) {
    const marker = v.current ? c.green('●') : c.gray('·');
    const num = c.cyan(`v${v.version}`.padEnd(7));
    const size = formatBytes(v.ciphertextSize).padStart(8);
    const when = new Date(v.createdAt).toLocaleString();
    const who = v.createdByEmail ?? 'unknown';
    const comment = v.comment ? `  ${c.gray('—')} ${v.comment}` : '';
    console.log(`  ${marker}  ${num} ${size}  ${c.gray(when)}  ${who}${comment}`);
  }
  console.log();
  muted(
    `${c.green('●')} = current (what \`envstore pull\` returns).  ` +
      `Use \`envstore rollback <N>\` to switch.`,
  );
}
