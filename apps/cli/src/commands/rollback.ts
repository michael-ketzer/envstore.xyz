// `envstore rollback <version> [--env <env>] [--yes]` — flip an environment's
// currentVersionId to a prior version. Doesn't create a new version — the
// pointer move IS the operation, with O(1) cost.
//
// Common usage:
//   envstore rollback 12                    → rolls "development" (or defaultEnv) to v12
//   envstore rollback 7 --env production    → rolls production to v7
//   envstore rollback 7 --yes               → non-interactive (CI)
//
// Multi-config (monorepo): pass --project to disambiguate.

import { isMultiConfig, validateSlug } from '@envstore/shared';

import { makeClient } from '../lib/api';
import type { Args } from '../lib/args';
import { findProjectConfig, resolveApiUrl } from '../lib/config';
import { CliError } from '../lib/errors';
import { c, info, muted, success } from '../lib/output';
import { askConfirm, requireTty } from '../lib/prompt';

type RollbackResponse = {
  ok: true;
  noop: boolean;
  versionId: string;
  version: number;
  environmentSlug: string;
};

function stringFlag(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export async function rollback(args: Args): Promise<void> {
  const target = args.positional[0];
  if (!target) {
    throw new CliError('Specify the version to roll back to.', {
      hint: 'Usage: envstore rollback <version> [--env <env>]',
    });
  }
  const versionNum = Number(target);
  if (!Number.isInteger(versionNum) || versionNum <= 0) {
    throw new CliError(`"${target}" is not a valid version number (positive integer).`);
  }

  const cfg = await findProjectConfig();
  if (!cfg) {
    throw new CliError('No envstore.json found here or in any parent directory.', {
      hint: 'Run `envstore init` in your project root, or `envstore link <CODE>`.',
    });
  }

  const apiUrl = await resolveApiUrl({ project: cfg.config });
  const client = makeClient(apiUrl);
  const { workspace } = cfg.config;

  // Same project/env resolution as `versions`.
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

  const envSlug =
    stringFlag(args.flags['env']) ??
    (!isMultiConfig(cfg.config) ? cfg.config.defaultEnv : undefined) ??
    'development';
  const slugCheck = validateSlug(envSlug);
  if (!slugCheck.ok) {
    throw new CliError(`Invalid environment slug "${envSlug}": ${slugCheck.reason}`);
  }

  // Interactive confirmation. `--yes` (and non-TTY runs) skip it — CI
  // wraps this in scripts and shouldn't get stuck.
  const isInteractive = process.stdin.isTTY === true;
  if (!args.flags['yes'] && isInteractive) {
    requireTty();
    info(
      `About to make ${c.cyan(`v${versionNum}`)} the current version for ` +
        `${c.cyan(`${workspace}/${projectSlug}/${envSlug}`)}.`,
    );
    muted('Future `envstore pull` will return this version. No data is deleted.');
    if (!askConfirm('Proceed?', false)) {
      throw new CliError('Cancelled.');
    }
  }

  const res = await client.post<RollbackResponse>(
    `/api/v1/workspaces/${workspace}/projects/${projectSlug}/environments/${envSlug}/current`,
    { version: versionNum },
  );

  if (res.noop) {
    muted(
      `${c.cyan(`v${res.version}`)} is already the current version for ${c.cyan(
        `${workspace}/${projectSlug}/${res.environmentSlug}`,
      )}. Nothing to do.`,
    );
    return;
  }

  success(
    `Rolled ${c.cyan(`${workspace}/${projectSlug}/${res.environmentSlug}`)} to ${c.cyan(
      `v${res.version}`,
    )}.`,
  );
  muted('Next `envstore pull` returns this version.');
}
