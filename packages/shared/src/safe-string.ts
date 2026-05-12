// Shared Zod refinements for user-displayed strings.
//
// Why: ANY string that round-trips through the API and is later printed in
// a terminal (CLI trust prompt, push progress lines, workspace picker) is a
// vector for terminal-escape injection — `\x1b[2K\r` clears the line and
// repaints, `\x07` rings the bell, `\b` rubs out a "Y/n", `\r` overwrites
// from the start. A malicious workspace admin who can set a recipient
// label could otherwise hide the trust-on-first-use warning that gates new
// recipients.
//
// Plus: embedded NUL bytes (`\x00`) make Postgres' `text` columns reject
// the insert with an unhandled error, surfacing as a 500. Catching them at
// the zod layer turns that into a clean 400.
//
// We reject the C0 control range (0x00–0x1f) AND DEL (0x7f). Tabs and
// newlines are also forbidden — neither belongs in a one-line label or
// name, and tabs render unpredictably in terminal-width-sensitive output.

import { z } from 'zod';

const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

export function hasControlChars(input: string): boolean {
  return CONTROL_CHARS.test(input);
}

// Zod refinement: rejects any string containing a C0 control char or DEL.
// Use as `.refine(...refineNoControlChars)` or `.refine(noControlChars, …)`.
export const noControlChars = (s: string): boolean => !CONTROL_CHARS.test(s);

// Inline factory for `z.string().min(1).max(N)` with control-char rejection
// and trim() applied. Tighter than the previous `z.string().min(1).max(N).trim()`
// pattern that allowed any character.
export function safeDisplayString(min: number, max: number) {
  return z
    .string()
    .min(min)
    .max(max)
    .refine(noControlChars, 'must not contain control characters or NUL bytes')
    .transform((s) => s.trim())
    // Re-check post-trim — a string of pure whitespace would now be empty.
    .refine((s) => s.length >= min, `must be at least ${min} characters after trimming`);
}
