// `envstore ls [workspaces|projects|envs]` — context-aware listing.
//
//   envstore ls               → if linked: envs in current project; else workspaces
//   envstore ls workspaces    → always lists workspaces
//   envstore ls projects [ws] → lists projects in workspace (defaults to linked one)
//   envstore ls envs [ws/proj]→ lists envs

import { PERSONAL_WORKSPACE_URL_SLUG, isMultiConfig } from '@envstore/shared';

import { makeClient } from '../lib/api';
import type { Args } from '../lib/args';
import { findProjectConfig, resolveApiUrl } from '../lib/config';
import { CliError } from '../lib/errors';
import { c, heading, muted } from '../lib/output';
import type { MeResponse, MeWorkspace } from '../lib/me';

type ProjectSummary = { slug: string; name: string };
type EnvSummary = {
  slug: string;
  name: string;
  currentVersion: { version: number; createdAt: string; ciphertextSize: number } | null;
  versionsCount: number;
};

export async function ls(args: Args): Promise<void> {
  const project = await findProjectConfig();
  const apiUrl = await resolveApiUrl({ project: project?.config ?? null });
  const client = makeClient(apiUrl);

  const what = args.positional[0] ?? (project ? 'envs' : 'workspaces');

  if (what === 'workspaces') {
    const me = await client.get<MeResponse>('/api/v1/me');
    printWorkspaces(me.workspaces);
    return;
  }

  if (what === 'projects') {
    const wsArg = args.positional[1] ?? project?.config.workspace;
    if (!wsArg) {
      throw new CliError('Specify a workspace: `envstore ls projects <workspace>`.');
    }
    const projects = await client.get<ProjectSummary[]>(
      `/api/v1/workspaces/${wsArg}/projects`,
    );
    printProjects(wsArg, projects);
    return;
  }

  if (what === 'envs') {
    const target = args.positional[1];
    let wsSlug: string;
    let projSlug: string;
    if (target) {
      const parts = target.split('/');
      if (parts.length !== 2) {
        throw new CliError('Use `envstore ls envs workspace/project`.');
      }
      wsSlug = parts[0]!;
      projSlug = parts[1]!;
    } else if (project) {
      wsSlug = project.config.workspace;
      if (isMultiConfig(project.config)) {
        // Multi config has many projects — caller must pick one.
        if (project.config.files.length === 1) {
          projSlug = project.config.files[0]!.project;
        } else {
          throw new CliError(
            'This envstore.json lists multiple files. Specify which project to list envs for.',
            {
              hint: `Try: envstore ls envs ${wsSlug}/<project>  (configured: ${project.config.files.map((f) => f.project).join(', ')})`,
            },
          );
        }
      } else {
        projSlug = project.config.project;
      }
    } else {
      throw new CliError('No envstore.json here.', {
        hint: 'Run `envstore link` first, or pass `envstore ls envs workspace/project`.',
      });
    }
    const envs = await client.get<EnvSummary[]>(
      `/api/v1/workspaces/${wsSlug}/projects/${projSlug}/environments`,
    );
    printEnvs(`${wsSlug}/${projSlug}`, envs);
    return;
  }

  throw new CliError(`Unknown target: ${what}`, {
    hint: 'Try: workspaces | projects | envs',
  });
}

function printWorkspaces(list: MeWorkspace[]): void {
  if (list.length === 0) {
    muted('No workspaces yet. Run `envstore init`.');
    return;
  }
  heading('Workspaces');
  for (const ws of list) {
    const displaySlug = ws.type === 'PERSONAL' ? PERSONAL_WORKSPACE_URL_SLUG : ws.slug;
    const type = c.gray(`(${ws.type.toLowerCase()})`);
    const role = c.gray(`[${ws.role.toLowerCase()}]`);
    console.log(`  ${c.cyan(displaySlug.padEnd(20))} ${ws.name} ${type} ${role}`);
  }
}

function printProjects(workspaceSlug: string, list: ProjectSummary[]): void {
  if (list.length === 0) {
    muted(`No projects in ${workspaceSlug} yet.`);
    return;
  }
  heading(`${workspaceSlug} / projects`);
  for (const p of list) {
    console.log(`  ${c.cyan(p.slug.padEnd(20))} ${p.name}`);
  }
}

function printEnvs(projectPath: string, list: EnvSummary[]): void {
  if (list.length === 0) {
    muted(`No environments in ${projectPath} yet. Push your first .env to create one.`);
    return;
  }
  heading(`${projectPath} / environments`);
  for (const env of list) {
    const ver = env.currentVersion
      ? `v${env.currentVersion.version} (${env.currentVersion.ciphertextSize}B)`
      : c.gray('never pushed');
    const total = c.gray(`${env.versionsCount} versions`);
    console.log(`  ${c.cyan(env.slug.padEnd(20))} ${env.name}  ${ver}  ${total}`);
  }
}
