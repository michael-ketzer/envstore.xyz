// `envstore genexample [file]` — derive `.env.example` from a real `.env`.
//
//   envstore genexample                       → reads .env, writes .env.example
//   envstore genexample .env.production       → reads that, writes .env.production.example
//   envstore genexample --out template.env    → custom output path
//   envstore genexample --stdout              → print to stdout instead of writing
//
// The output keeps comments and blank lines, drops every value, and dedupes
// keys. The example file is meant to be committed; the source file is not.

import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

import { dotenvExample, isText, parseDotenv } from '@envstore/shared';

import type { Args } from '../lib/args';
import { CliError } from '../lib/errors';
import { c, info, muted, success, warn } from '../lib/output';

export async function genexample(args: Args): Promise<void> {
  const inputArg = args.positional[0] ?? '.env';
  const inputPath = isAbsolute(inputArg) ? inputArg : resolve(process.cwd(), inputArg);

  const force = Boolean(args.flags['force']);
  const useStdout = Boolean(args.flags['stdout']);
  const outFlag = typeof args.flags['out'] === 'string' ? args.flags['out'] : undefined;

  let raw: Uint8Array;
  try {
    raw = await readFile(inputPath);
  } catch (err) {
    throw new CliError(`Cannot read ${inputArg}: ${(err as Error).message}`, {
      hint: "Pass a path argument if your source file isn't named `.env`.",
    });
  }
  const text = isText(raw);
  if (!text.ok) {
    throw new CliError(
      `${inputArg} doesn't look like text (${text.reason}). Refusing to parse as .env.`,
    );
  }

  const lines = parseDotenv(new TextDecoder().decode(raw));
  const exampleText = dotenvExample(lines);

  if (useStdout) {
    process.stdout.write(exampleText);
    return;
  }

  const outPath = outFlag
    ? isAbsolute(outFlag)
      ? outFlag
      : resolve(process.cwd(), outFlag)
    : defaultExamplePath(inputPath);

  if (!force) {
    try {
      await stat(outPath);
      throw new CliError(`${displayPath(outPath)} already exists.`, {
        hint: 'Pass --force to overwrite, or --out <path> for a different filename.',
      });
    } catch (err) {
      if (err instanceof CliError) throw err;
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  await writeFile(outPath, exampleText, { mode: 0o644 });

  const keyCount = lines.filter((line) => line.type === 'kv').length;
  success(`Wrote ${c.cyan(displayPath(outPath))} (${keyCount} key${keyCount === 1 ? '' : 's'}).`);
  muted(`Commit ${c.cyan(basename(outPath))} so teammates know what to fill in.`);
  if (relative(process.cwd(), inputPath) === '.env') {
    warn('Keep .env in .gitignore — only the example file should be committed.');
  }
}

function defaultExamplePath(input: string): string {
  const dir = dirname(input);
  const base = basename(input);
  // `.env` → `.env.example`
  // `.env.production` → `.env.production.example`
  // anything weird → `<file>.example`
  return resolve(dir, `${base}.example`);
}

function displayPath(p: string): string {
  return relative(process.cwd(), p) || basename(p);
}
