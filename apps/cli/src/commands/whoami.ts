// `envstore whoami` — confirms the token works and prints user + workspace summary.

import { PERSONAL_WORKSPACE_URL_SLUG, isMultiConfig } from '@envstore/shared';

import { makeClient } from '../lib/api';
import type { Args } from '../lib/args';
import { resolveApiUrl, findProjectConfig } from '../lib/config';
import { loadIdentity } from '../lib/identity';
import type { MeResponse } from '../lib/me';
import { c, heading, info, muted } from '../lib/output';

export async function whoami(_args: Args): Promise<void> {
  const project = await findProjectConfig();
  const apiUrl = await resolveApiUrl({ project: project?.config ?? null });
  const client = makeClient(apiUrl);
  const me = await client.get<MeResponse>('/api/v1/me');
  const identity = await loadIdentity();

  heading(me.user.name ?? me.user.email);
  muted(`  ${me.user.email}`);
  muted(`  API: ${apiUrl}`);
  console.log();

  if (identity) {
    heading('Identity');
    console.log(`  ${c.gray('public key:')} ${identity.recipient}`);
    console.log(`  ${c.gray('stored in: ')} ${identity.source}`);
    console.log();
  } else {
    muted('No local identity yet. Run `envstore identity init` to create one.');
    console.log();
  }

  if (me.workspaces.length > 0) {
    heading('Workspaces');
    for (const ws of me.workspaces) {
      // Personal workspaces are always routed via /me; surface that here
      // instead of the auto-generated DB slug (typically the email local-part).
      const displaySlug = ws.type === 'PERSONAL' ? PERSONAL_WORKSPACE_URL_SLUG : ws.slug;
      const type = c.gray(`(${ws.type.toLowerCase()})`);
      const role = c.gray(`[${ws.role.toLowerCase()}]`);
      console.log(`  ${c.cyan(displaySlug)} ${ws.name} ${type} ${role}`);
    }
    console.log();
  }

  if (project) {
    if (isMultiConfig(project.config)) {
      heading(`Linked monorepo (${project.config.files.length} files)`);
      console.log(`  ${c.gray('workspace:')} ${project.config.workspace}`);
      for (const f of project.config.files) {
        const envSuffix = f.environment ? ` ${c.gray(`(${f.environment})`)}` : '';
        console.log(`  ${c.cyan(f.path)} → ${f.project}${envSuffix}`);
      }
      console.log(`  ${c.gray('config:')} ${project.path}`);
    } else {
      heading('Linked project');
      console.log(`  ${project.config.workspace}/${project.config.project}`);
      console.log(`  ${c.gray('config:')} ${project.path}`);
    }
  } else {
    muted('No envstore.json found in cwd or parents.');
    muted('Run `envstore link` or `envstore init` here to connect this directory.');
  }

  info('');
}
