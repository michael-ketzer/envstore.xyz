// Interactive prompts. Bun provides `prompt()` and `confirm()` as globals;
// we wrap them so commands can pass defaults and validation.

declare function prompt(question?: string, initial?: string): string | null;
declare function confirm(question?: string): boolean;

import { CliError, UsageError } from './errors';
import { c } from './output';

export function askText(
  question: string,
  opts?: { default?: string; required?: boolean; validate?: (v: string) => string | null },
): string {
  for (;;) {
    const display = opts?.default
      ? `${c.bold(question)} ${c.gray(`(${opts.default})`)}`
      : c.bold(question);
    const raw = prompt(`${display} `) ?? '';
    const value = raw.trim() || opts?.default || '';
    if (!value && opts?.required) {
      console.log(c.red('Value required.'));
      continue;
    }
    const err = opts?.validate?.(value);
    if (err) {
      console.log(c.red(err));
      continue;
    }
    return value;
  }
}

export function askConfirm(question: string, defaultYes = false): boolean {
  const tail = defaultYes ? c.gray('[Y/n]') : c.gray('[y/N]');
  // Bun's `prompt()` writes its argument to stderr in a default dim style,
  // which makes plain text wash out against bolded picker headers. Bolding
  // the question keeps the action point readable.
  const raw = prompt(`${c.bold(question)} ${tail} `) ?? '';
  const v = raw.trim().toLowerCase();
  if (!v) return defaultYes;
  return v === 'y' || v === 'yes';
}

export function askChoice<T extends string>(
  question: string,
  choices: ReadonlyArray<{ value: T; label: string; hint?: string }>,
  opts?: { default?: T },
): T {
  console.log(question);
  choices.forEach((choice, i) => {
    const num = `${i + 1}`.padStart(2);
    const hint = choice.hint ? ` ${c.gray(`— ${choice.hint}`)}` : '';
    console.log(`  ${c.cyan(num)}) ${choice.label}${hint}`);
  });
  const defaultIdx = opts?.default
    ? choices.findIndex((c2) => c2.value === opts.default)
    : -1;
  for (;;) {
    const raw = prompt(`Select ${defaultIdx >= 0 ? c.gray(`(${defaultIdx + 1})`) + ' ' : ''}`) ?? '';
    const trimmed = raw.trim();
    const n = trimmed === '' && defaultIdx >= 0 ? defaultIdx + 1 : Number.parseInt(trimmed, 10);
    if (Number.isInteger(n) && n >= 1 && n <= choices.length) {
      return choices[n - 1]!.value;
    }
    console.log(c.red(`Enter a number between 1 and ${choices.length}.`));
  }
}

export function requireTty(): void {
  if (!process.stdin.isTTY) {
    throw new UsageError(
      'This command needs an interactive terminal.',
      'Pipe in answers via flags instead, or run interactively.',
    );
  }
}

export { CliError };
