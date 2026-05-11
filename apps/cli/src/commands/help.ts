// `envstore help [command]` — usage strings.

import type { Args } from '../lib/args';
import { c, heading } from '../lib/output';
import { CLI_VERSION } from '../lib/paths';

type Section = { title: string; entries: ReadonlyArray<readonly [string, string]> };

const SECTIONS: ReadonlyArray<Section> = [
  {
    title: 'Auth',
    entries: [
      ['login', 'Sign in via device-code flow'],
      ['logout', 'Sign out (revoke token server-side + delete locally)'],
      ['whoami', 'Show current user, identity, workspaces, linked project'],
    ],
  },
  {
    title: 'Identity',
    entries: [
      ['identity init', 'Generate an age keypair and register it with the server'],
      ['identity show', 'Print the local public recipient'],
      ['identity export <file>', 'Back up the secret key to a file (mode 0600)'],
      ['identity export --clipboard', 'Copy the key to clipboard (paste into Apple Passwords / 1Password)'],
      ['identity import <file>', 'Restore an exported secret key from a file'],
      ['identity import --clipboard', 'Restore from the system clipboard'],
      ['identity import -', 'Restore from stdin (e.g. `pbpaste | envstore identity import -`)'],
      ['identity register', 'Re-register the local recipient with the server'],
      ['identity remove --yes', 'Wipe the local secret key (irreversible)'],
    ],
  },
  {
    title: 'Project setup',
    entries: [
      ['init', 'Create workspace and/or project, write envstore.json'],
      ['link [workspace/project]', 'Write envstore.json for an existing project'],
    ],
  },
  {
    title: 'Push / pull (single project)',
    entries: [
      ['push [file]', 'Encrypt + upload (default file: .env). Prompts for env when bare .env.'],
      ['push .env.production', 'Auto-detects environment from filename'],
      ['push .env --env staging', 'Override the detected env'],
      ['pull [env]', 'Download + decrypt (defaults: env=development, file=.env.<env>)'],
      ['pull staging --out .env.local', 'Custom output path'],
      ['pull staging --version 3', 'Pull a specific historical version'],
    ],
  },
  {
    title: 'Push / pull (monorepo — files[] in envstore.json)',
    entries: [
      ['push', 'Encrypt + upload every file in envstore.json'],
      ['push apps/web', 'Path-prefix filter — push only files under apps/web'],
      ['push --project shinra-web', 'Filter by configured project slug'],
      ['push --env production', 'Filter by configured environment'],
      ['pull', 'Pull every file in envstore.json'],
      ['pull apps/web/.env.local', 'Pull exactly that one file'],
    ],
  },
  {
    title: 'Inspect',
    entries: [
      ['ls', 'List workspaces, projects, or environments'],
      ['ls workspaces', 'List workspaces'],
      ['ls projects [workspace]', 'List projects in a workspace'],
      ['ls envs [workspace/project]', 'List environments in a project'],
    ],
  },
  {
    title: 'About',
    entries: [
      ['licenses', 'Print third-party licenses bundled with envstore'],
    ],
  },
] as const;

export async function help(_args: Args): Promise<void> {
  console.log(`${c.bold('envstore')} ${c.gray(`v${CLI_VERSION}`)}`);
  console.log('Zero-knowledge encrypted .env file storage.');
  console.log();
  console.log(`${c.bold('Usage:')}  envstore <command> [args] [flags]`);
  console.log();
  for (const section of SECTIONS) {
    heading(section.title);
    for (const [cmd, desc] of section.entries) {
      console.log(`  ${c.cyan(cmd.padEnd(34))} ${desc}`);
    }
    console.log();
  }
  console.log(`${c.bold('Global flags:')}`);
  console.log(`  ${c.cyan('--api-url <url>'.padEnd(34))} Override API URL (default: ENVSTORE_API_URL or envstore.xyz)`);
  console.log(`  ${c.cyan('--help'.padEnd(34))} Show this help`);
  console.log(`  ${c.cyan('--version'.padEnd(34))} Print CLI version`);
  console.log();
  console.log(c.gray('Run `envstore <command> --help` for command-specific help.'));
}
