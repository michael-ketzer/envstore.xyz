// `envstore trust <subcommand>` — manage the local recipient-trust cache.
//
//   list             Show every (apiUrl, workspace, project) we have a
//                    cached recipient set for, plus the recipients themselves.
//   reset            Clear cached trust. Without flags, clears the entry for
//                    the current envstore.json's workspace+project on the
//                    configured apiUrl. With --workspace or --all, wider.
//   path             Print the trust file location.
//
// The cache lives at `~/.config/envstore/trust.json` (mode 0600) and is the
// CLI's defense against active server compromise injecting an attacker
// recipient into a push. Clearing it forces a TOFU "first contact" on the
// next push, which trusts whatever the server returns — only use that when
// you genuinely want to re-bootstrap (new envstore deployment, after
// resolving a flagged diff, etc.).

import type { Args } from '../lib/args';
import { findProjectConfig, resolveApiUrl } from '../lib/config';
import { CliError, UsageError } from '../lib/errors';
import { c, heading, info, muted, success } from '../lib/output';
import {
  clearTrust,
  loadTrustFile,
  saveTrustFile,
  trustFilePath,
} from '../lib/trust';

export async function trust(args: Args): Promise<void> {
  const [sub] = args.positional;
  switch (sub) {
    case undefined:
    case 'list':
      return trustList();
    case 'reset':
      return trustReset(args);
    case 'path':
      console.log(trustFilePath());
      return;
    default:
      throw new UsageError(
        `Unknown subcommand: trust ${sub}`,
        'Try: envstore trust [list|reset|path]',
      );
  }
}

async function trustList(): Promise<void> {
  const file = await loadTrustFile();
  const apiUrls = Object.keys(file.trust);
  if (apiUrls.length === 0) {
    muted('Trust cache is empty. Push from this machine to populate it.');
    muted(`File: ${trustFilePath()}`);
    return;
  }
  heading('Cached recipient sets:');
  console.log();
  for (const apiUrl of apiUrls.sort()) {
    console.log(c.bold(apiUrl));
    const byWs = file.trust[apiUrl]!;
    for (const ws of Object.keys(byWs).sort()) {
      const byProj = byWs[ws]!;
      for (const proj of Object.keys(byProj).sort()) {
        const entry = byProj[proj]!;
        console.log(
          `  ${c.cyan(`${ws}/${proj}`)} ${c.gray(`— ${entry.recipients.length} recipient${entry.recipients.length === 1 ? '' : 's'}, last updated ${entry.updatedAt}`)}`,
        );
        for (const r of entry.recipients) {
          console.log(`    ${c.gray(r)}`);
        }
      }
    }
    console.log();
  }
  muted(`File: ${trustFilePath()}`);
}

async function trustReset(args: Args): Promise<void> {
  const all = Boolean(args.flags['all']);
  const wsFlag = stringFlag(args.flags['workspace']);
  const projFlag = stringFlag(args.flags['project']);

  if (all && (wsFlag || projFlag)) {
    throw new UsageError('--all conflicts with --workspace/--project.');
  }

  const file = await loadTrustFile();
  if (Object.keys(file.trust).length === 0) {
    muted('Trust cache is already empty.');
    return;
  }

  if (all) {
    // Wipe the whole file — drops every cached set on this machine. Next
    // push to anything is a fresh TOFU.
    await saveTrustFile({ version: file.version, trust: {} });
    success('Cleared the entire trust cache.');
    info('The next push to any project will TOFU on the current recipient set.');
    return;
  }

  // Default behavior: scope to current envstore.json's workspace/project on
  // the resolved apiUrl. The global `--api-url` flag (parsed in index.ts)
  // already overrides the apiUrl for this invocation, so we just resolve.
  const cfg = await findProjectConfig();
  const apiUrl = await resolveApiUrl({ project: cfg?.config ?? null });
  const workspace = wsFlag ?? cfg?.config.workspace;
  if (!workspace) {
    throw new CliError(
      'No workspace context — pass --workspace=<slug> or run inside an envstore project.',
    );
  }
  // `project` is null = clear every project under the workspace. Explicit
  // null happens when the user passes only --workspace; we don't infer
  // project from a config when --workspace is set, to keep "I'm targeting
  // this workspace" workspace-wide.
  let project: string | null = null;
  if (projFlag !== undefined) {
    project = projFlag;
  } else if (cfg && !wsFlag) {
    project = configProject(cfg.config);
  }

  const next = clearTrust(file, apiUrl, workspace, project);
  if (next === file) {
    muted(
      `No cached trust for ${apiUrl} ${workspace}${project ? `/${project}` : ''}. Nothing to do.`,
    );
    return;
  }
  await saveTrustFile(next);
  const scope = project
    ? `${workspace}/${project} on ${apiUrl}`
    : `${workspace} (every project) on ${apiUrl}`;
  success(`Cleared trust cache for ${scope}.`);
  info('The next push to this scope will TOFU on the current recipient set.');
}

function configProject(config: { project?: string; files?: { project: string }[] }): string | null {
  if (config.project) return config.project;
  if (config.files && config.files.length > 0) {
    const projects = new Set(config.files.map((f) => f.project));
    if (projects.size === 1) return [...projects][0]!;
  }
  return null;
}

function stringFlag(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}
