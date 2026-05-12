#!/usr/bin/env bun
// envstore CLI entrypoint.
//
// We parse all argv up front so global flags (--api-url, --help, --version)
// can appear before OR after the command name. The first positional after
// parsing is the command; anything left becomes the command's own args.

import { parseArgs, type Args } from './lib/args';
import { CliError } from './lib/errors';
import { c, error } from './lib/output';
import { CLI_VERSION } from './lib/paths';
import { help } from './commands/help';
import { identity } from './commands/identity';
import { init } from './commands/init';
import { licenses } from './commands/licenses';
import { link } from './commands/link';
import { login } from './commands/login';
import { logout } from './commands/logout';
import { ls } from './commands/ls';
import { pull } from './commands/pull';
import { push } from './commands/push';
import { rekey } from './commands/rekey';
import { sync } from './commands/sync';
import { token } from './commands/token';
import { whoami } from './commands/whoami';

type Handler = (args: Args) => Promise<void>;

const COMMANDS: Record<string, Handler> = {
  login,
  logout,
  whoami,
  identity,
  init,
  link,
  ls,
  list: ls, // alias
  push,
  pull,
  rekey,
  sync,
  token,
  licenses,
  help,
};

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);

  if (parsed.flags['version'] || parsed.flags['v']) {
    console.log(CLI_VERSION);
    return 0;
  }
  if (typeof parsed.flags['api-url'] === 'string') {
    // `--api-url` overrides ENVSTORE_API_URL for this process.
    process.env.ENVSTORE_API_URL = parsed.flags['api-url'];
  }

  const [cmdName, ...restPositional] = parsed.positional;

  // No command (or just `--help`) → top-level help.
  if (!cmdName) {
    await help(parsed);
    return 0;
  }

  const handler = COMMANDS[cmdName];
  if (!handler) {
    error(`Unknown command: ${cmdName}`);
    console.error(`Run ${c.cyan('`envstore help`')} for a list of commands.`);
    return 2;
  }

  // Build command-scoped args (strip the command name from positional).
  const cmdArgs: Args = {
    positional: restPositional,
    flags: parsed.flags,
    raw: parsed.raw,
  };

  if (cmdArgs.flags['help'] || cmdArgs.flags['h']) {
    await help(cmdArgs);
    return 0;
  }

  try {
    await handler(cmdArgs);
    return 0;
  } catch (err) {
    if (err instanceof CliError) {
      error(err.message);
      if (err.hint) console.error(c.gray(err.hint));
      return err.exitCode;
    }
    error(`Unexpected error: ${(err as Error).message}`);
    if (process.env.ENVSTORE_DEBUG) console.error((err as Error).stack);
    return 1;
  }
}

process.exit(await main(process.argv.slice(2)));
