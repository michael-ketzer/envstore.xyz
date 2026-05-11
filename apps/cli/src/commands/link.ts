// `envstore link [target]` — writes envstore.json in cwd.
//
// Three forms for the positional argument:
//   envstore link                      Interactive picker
//   envstore link acme/api             Workspace + project slugs (must exist)
//   envstore link AB12-CD34            Setup code from the project dashboard
//
// Never creates server-side workspaces — but in the setup-code form it can
// optionally create additional projects when it detects this is a monorepo
// with multiple .env files, so the user gets a one-shot multi-config setup
// after pasting the dashboard's link command.

import { join } from 'node:path';

import {
  DEVICE_CODE_USER_CODE_REGEX,
  ENVSTORE_CONFIG_FILENAME,
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
import { CliError, UsageError } from '../lib/errors';
import {
  describeMarkers,
  detectMonorepoMarkers,
  hasAnyMonorepoMarker,
  scanEnvFiles,
  suggestProjectSlugForFile,
} from '../lib/monorepo';
import { c, info, muted, success } from '../lib/output';
import { askChoice, askConfirm, askText, requireTty } from '../lib/prompt';
import type { MeResponse, MeWorkspace } from '../lib/me';

type ProjectSummary = {
  slug: string;
  name: string;
  group?: { slug: string; name: string } | null;
};

type RedeemResponse = {
  workspace: string;
  project: string;
  group: { slug: string; name: string } | null;
};

function normalizeCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

function looksLikeCode(input: string): boolean {
  if (input.includes('/')) return false;
  return DEVICE_CODE_USER_CODE_REGEX.test(normalizeCode(input));
}

export async function link(args: Args): Promise<void> {
  const cwd = process.cwd();
  const existing = await findProjectConfig(cwd);
  if (existing && existing.path === join(cwd, ENVSTORE_CONFIG_FILENAME) && !args.flags['force']) {
    throw new CliError(`${ENVSTORE_CONFIG_FILENAME} already exists in ${cwd}.`, {
      hint: 'Pass --force to overwrite.',
    });
  }

  const apiUrl = await resolveApiUrl();
  const client = makeClient(apiUrl);

  // Setup-code form: positional looks like XXXX-XXXX.
  if (args.positional[0] && looksLikeCode(args.positional[0])) {
    return linkByCode(args.positional[0], { client, apiUrl, cwd, args });
  }

  // Slug form: workspace[/project] from positional or --workspace/--project flags.
  let targetWs: string | undefined =
    (typeof args.flags['workspace'] === 'string' && args.flags['workspace']) || undefined;
  let targetProj: string | undefined =
    (typeof args.flags['project'] === 'string' && args.flags['project']) || undefined;
  if (args.positional[0]) {
    const parts = args.positional[0].split('/');
    if (parts.length === 2) {
      targetWs ??= parts[0];
      targetProj ??= parts[1];
    } else if (parts.length === 1) {
      targetWs ??= parts[0];
    } else {
      throw new UsageError(
        'Pass either `workspace/project` or a setup code like XXXX-XXXX.',
      );
    }
  }

  const me = await client.get<MeResponse>('/api/v1/me');
  if (me.workspaces.length === 0) {
    throw new CliError('No workspaces yet.', {
      hint: 'Run `envstore init` to create one and link this directory.',
    });
  }

  let workspace: MeWorkspace;
  if (targetWs) {
    const ws = me.workspaces.find((w) => w.slug === targetWs);
    if (!ws) throw new CliError(`Workspace "${targetWs}" not found.`);
    workspace = ws;
  } else {
    requireTty();
    const slug = askChoice<string>(
      'Pick a workspace:',
      me.workspaces.map((w) => ({
        value: w.slug,
        label: `${w.name} (${w.slug})`,
        hint: w.type.toLowerCase(),
      })),
    );
    workspace = me.workspaces.find((w) => w.slug === slug)!;
  }

  const projects = await client.get<ProjectSummary[]>(
    `/api/v1/workspaces/${workspace.slug}/projects`,
  );
  if (projects.length === 0) {
    throw new CliError(`Workspace "${workspace.slug}" has no projects yet.`, {
      hint: 'Run `envstore init` to create one.',
    });
  }

  let project: ProjectSummary;
  if (targetProj) {
    const p = projects.find((p2) => p2.slug === targetProj);
    if (!p) throw new CliError(`Project "${targetProj}" not found in ${workspace.slug}.`);
    project = p;
  } else {
    requireTty();
    const slug = askChoice<string>(
      'Pick a project:',
      projects.map((p) => ({ value: p.slug, label: `${p.name} (${p.slug})` })),
    );
    project = projects.find((p) => p.slug === slug)!;
  }

  await writeLinkedFlatConfig({
    cwd,
    apiUrl,
    workspaceSlug: workspace.slug,
    projectSlug: project.slug,
  });
  info(`${c.gray('workspace:')} ${workspace.slug}`);
  info(`${c.gray('project:')}   ${project.slug}`);
  muted('Commit envstore.json to your repo so teammates run `envstore pull` straight from the clone.');
}

async function linkByCode(
  rawCode: string,
  ctx: {
    client: ReturnType<typeof makeClient>;
    apiUrl: string;
    cwd: string;
    args: Args;
  },
): Promise<void> {
  const normalized = normalizeCode(rawCode);
  const redeemed = await ctx.client.post<RedeemResponse>('/api/v1/link-codes/redeem', {
    code: normalized,
  });

  // Look for a monorepo + extra .env files. If found and the user agrees, we
  // skip the flat-config write and go through the multi-file flow instead.
  const expanded = await maybeExpandLinkIntoMonorepo({
    client: ctx.client,
    apiUrl: ctx.apiUrl,
    cwd: ctx.cwd,
    redeemed,
  });
  if (expanded) return;

  // Plain link: write the single-project flat config.
  await writeLinkedFlatConfig({
    cwd: ctx.cwd,
    apiUrl: ctx.apiUrl,
    workspaceSlug: redeemed.workspace,
    projectSlug: redeemed.project,
  });
  info(`${c.gray('workspace:')} ${redeemed.workspace}`);
  info(`${c.gray('project:')}   ${redeemed.project}`);
  muted(
    `Commit ${ENVSTORE_CONFIG_FILENAME} so teammates can \`envstore pull\` straight from the clone.`,
  );
}

// If cwd looks like a monorepo with multiple env files, offer to register all
// of them under one envstore.json. The redeemed project becomes one entry
// (you pick which file it's for); the rest get prompted per file, with new
// projects auto-created and tagged with the same group. Returns true if the
// multi-file config was written; false if the user declined (caller falls
// back to the flat-config write).
async function maybeExpandLinkIntoMonorepo(opts: {
  client: ReturnType<typeof makeClient>;
  apiUrl: string;
  cwd: string;
  redeemed: RedeemResponse;
}): Promise<boolean> {
  const { client, apiUrl, cwd, redeemed } = opts;
  const markers = await detectMonorepoMarkers(cwd);
  if (!hasAnyMonorepoMarker(markers)) return false;
  const envFiles = await scanEnvFiles(cwd);
  if (envFiles.length < 2) return false;

  requireTty();
  console.log();
  info(`Detected monorepo (${describeMarkers(markers)}).`);
  info(`Found ${envFiles.length} env files in this repo:`);
  for (const f of envFiles) console.log(`  ${c.gray(f)}`);
  console.log();
  info(
    `The link gave you the ${c.cyan(redeemed.project)} project${
      redeemed.group ? ` (group ${c.cyan(redeemed.group.slug)})` : ''
    }.`,
  );
  if (
    !askConfirm(
      'Register every file (creating new projects in the same group as needed)?',
      true,
    )
  ) {
    return false;
  }

  // Group choice: prefer the redeemed project's existing group; otherwise
  // suggest a sensible default from the repo root and let the user override.
  const groupDefault =
    redeemed.group?.slug ?? slugify(redeemed.project) ?? 'monorepo';
  const group = redeemed.group
    ? redeemed.group.slug
    : askText('Group name for these projects', {
        default: groupDefault,
        required: true,
        validate: (v) => {
          const r = validateSlug(v);
          return r.ok ? null : r.reason;
        },
      });

  // Existing projects in the workspace — we reuse slugs that already exist
  // and only create the missing ones.
  let projects = await client.get<ProjectSummary[]>(
    `/api/v1/workspaces/${redeemed.workspace}/projects`,
  );

  // Pick which file the redeemed project corresponds to. Heuristic: a file
  // whose suggested slug matches the redeemed project's slug wins; otherwise
  // we ask the user once.
  const suggestionsByFile = await Promise.all(
    envFiles.map(async (f) => slugify(await suggestProjectSlugForFile(cwd, f))),
  );
  let primaryFileIndex = suggestionsByFile.findIndex((s) => s === redeemed.project);
  if (primaryFileIndex === -1) {
    primaryFileIndex = askPickChoice(
      `Which file is the ${c.cyan(redeemed.project)} project for?`,
      envFiles,
    );
  }

  const entries: EnvstoreFileEntry[] = [];
  for (const [i, filePath] of envFiles.entries()) {
    if (i === primaryFileIndex) {
      entries.push({ path: filePath, project: redeemed.project });
      continue;
    }
    console.log();
    info(`${c.cyan(filePath)}`);
    const suggestion = suggestionsByFile[i] || 'project';
    const projectSlug = askText('  Project slug', {
      default: suggestion,
      required: true,
      validate: (v) => {
        const r = validateSlug(v);
        return r.ok ? null : r.reason;
      },
    });
    if (!projects.some((p) => p.slug === projectSlug)) {
      const created = await client.post<ProjectSummary>(
        `/api/v1/workspaces/${redeemed.workspace}/projects`,
        { slug: projectSlug, name: projectSlug, group },
      );
      success(`  Created project ${redeemed.workspace}/${created.slug}.`);
      projects = [...projects, created];
    }
    entries.push({ path: filePath, project: projectSlug });
  }

  const target = join(cwd, ENVSTORE_CONFIG_FILENAME);
  const content = renderEnvstoreConfig({
    workspace: redeemed.workspace,
    files: entries,
    schemaUrl: `${apiUrl}/schema/envstore.json`,
  });
  await writeProjectConfig(target, content);

  console.log();
  success(`Wrote ${ENVSTORE_CONFIG_FILENAME} (${entries.length} files, grouped as ${c.cyan(group)}).`);
  console.log(`  ${c.gray('workspace:')} ${c.cyan(redeemed.workspace)}`);
  for (const e of entries) {
    console.log(`  ${c.cyan(e.path)} → ${e.project}`);
  }
  console.log();
  muted('Commit this file. It contains no secrets — just routing info.');
  muted('Next: `envstore identity init` (if you haven\'t yet), then `envstore push`.');
  return true;
}

// Tiny helper for indexed file picks. askChoice takes string values; we wrap
// it so the caller gets back the chosen INDEX instead.
function askPickChoice(question: string, items: string[]): number {
  const choice = askChoice<string>(
    question,
    items.map((label, idx) => ({ value: String(idx), label })),
  );
  return Number.parseInt(choice, 10);
}

async function writeLinkedFlatConfig(opts: {
  cwd: string;
  apiUrl: string;
  workspaceSlug: string;
  projectSlug: string;
}): Promise<void> {
  const target = join(opts.cwd, ENVSTORE_CONFIG_FILENAME);
  const content = renderEnvstoreConfig({
    workspace: opts.workspaceSlug,
    project: opts.projectSlug,
    schemaUrl: `${opts.apiUrl}/schema/envstore.json`,
  });
  await writeProjectConfig(target, content);
  success(
    `Linked ${c.cyan(`${opts.workspaceSlug}/${opts.projectSlug}`)} → ${ENVSTORE_CONFIG_FILENAME}.`,
  );
}
