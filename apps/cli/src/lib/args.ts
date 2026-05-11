// Tiny argv parser. Supports:
//   envstore <cmd> [<sub>] [positional...] [--flag] [--flag=value] [--flag value]
//
// Unknown flags don't error here — commands inspect what they care about.

export type Args = {
  positional: string[];
  flags: Record<string, string | true>;
  // Raw flag list (in case a command wants to forward them).
  raw: string[];
};

const NEEDS_VALUE = new Set([
  'workspace',
  'project',
  'env',
  'name',
  'slug',
  'description',
  'api-url',
  'out',
  'comment',
]);

export function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  const raw: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    raw.push(arg);
    if (arg === '--') {
      // Everything after `--` is positional.
      for (i++; i < argv.length; i++) {
        positional.push(argv[i]!);
        raw.push(argv[i]!);
      }
      break;
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq >= 0) {
        const key = arg.slice(2, eq);
        flags[key] = arg.slice(eq + 1);
        continue;
      }
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (NEEDS_VALUE.has(key) && next !== undefined && !next.startsWith('-')) {
        flags[key] = next;
        raw.push(next);
        i++;
      } else {
        flags[key] = true;
      }
      continue;
    }
    if (arg.startsWith('-') && arg.length > 1) {
      flags[arg.slice(1)] = true;
      continue;
    }
    positional.push(arg);
  }

  return { positional, flags, raw };
}
