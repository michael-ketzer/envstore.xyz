// `envstore link [target]` — writes envstore.json in cwd.
//
// Three forms for the positional argument:
//   envstore link                      Interactive picker
//   envstore link acme/api             Workspace + project slugs (must exist)
//   envstore link AB12-CD34            Setup code from the project dashboard
//
// Never creates server-side resources — use `envstore init` for that.

import { join } from 'node:path';

import {
  DEVICE_CODE_USER_CODE_REGEX,
  ENVSTORE_CONFIG_FILENAME,
  renderEnvstoreConfig,
} from '@envstore/shared';

import { makeClient } from '../lib/api';
import type { Args } from '../lib/args';
import {
  findProjectConfig,
  resolveApiUrl,
  writeProjectConfig,
} from '../lib/config';
import { CliError, UsageError } from '../lib/errors';
import { c, info, muted, success } from '../lib/output';
import { askChoice, requireTty } from '../lib/prompt';
import type { MeResponse, MeWorkspace } from '../lib/me';

type ProjectSummary = { slug: string; name: string };

type RedeemResponse = {
  workspace: string;
  project: string;
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
    return linkByCode(args.positional[0], { client, apiUrl, cwd });
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

  await writeLinkedConfig({
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
  ctx: { client: ReturnType<typeof makeClient>; apiUrl: string; cwd: string },
): Promise<void> {
  const normalized = normalizeCode(rawCode);
  const result = await ctx.client.post<RedeemResponse>('/api/v1/link-codes/redeem', {
    code: normalized,
  });
  await writeLinkedConfig({
    cwd: ctx.cwd,
    apiUrl: ctx.apiUrl,
    workspaceSlug: result.workspace,
    projectSlug: result.project,
  });
  info(`${c.gray('workspace:')} ${result.workspace}`);
  info(`${c.gray('project:')}   ${result.project}`);
  muted(
    `Commit ${ENVSTORE_CONFIG_FILENAME} so teammates can \`envstore pull\` straight from the clone.`,
  );
}

async function writeLinkedConfig(opts: {
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
