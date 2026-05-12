// Minimal .env parser/serializer.
//
// Supports the common dotenv format:
//   KEY=value
//   KEY="quoted value"
//   KEY='single quoted'
//   # comment lines
//   blank lines
//   export KEY=value (the `export` prefix is consumed silently)
//
// Multi-line values via backslash continuation or quoted strings spanning
// newlines are NOT supported in this MVP — they're rare in actual .env files
// and complicate the round-trip preservation that `set` and `genexample`
// depend on.

export type DotenvComment = { type: 'comment'; raw: string };
export type DotenvBlank = { type: 'blank' };
export type DotenvKeyValue = { type: 'kv'; key: string; value: string; raw: string };
export type DotenvLine = DotenvComment | DotenvBlank | DotenvKeyValue;

const VALID_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseDotenv(input: string): DotenvLine[] {
  const lines = input.split(/\r?\n/);
  // `split` on input ending in "\n" produces a trailing empty string we don't
  // want to count as a real blank line.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.map(parseLine);
}

function parseLine(line: string): DotenvLine {
  const trimmed = line.trim();
  if (trimmed === '') return { type: 'blank' };
  if (trimmed.startsWith('#')) return { type: 'comment', raw: line };

  const exportMatch = line.match(/^\s*export\s+/);
  const afterExport = exportMatch ? line.slice(exportMatch[0].length) : line;

  const eq = afterExport.indexOf('=');
  if (eq < 0) return { type: 'comment', raw: line };
  const key = afterExport.slice(0, eq).trim();
  if (!VALID_KEY.test(key)) return { type: 'comment', raw: line };

  const value = parseValue(afterExport.slice(eq + 1));
  return { type: 'kv', key, value, raw: line };
}

function parseValue(raw: string): string {
  let s = raw.replace(/^\s+/, '');
  if (!(s.startsWith('"') || s.startsWith("'"))) {
    const hashIdx = s.indexOf(' #');
    if (hashIdx >= 0) s = s.slice(0, hashIdx);
    return s.trimEnd();
  }
  const quote = s[0];
  let i = 1;
  let out = '';
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\' && quote === '"') {
      const next = s[i + 1];
      if (next === 'n') {
        out += '\n';
        i += 2;
        continue;
      }
      if (next === 'r') {
        out += '\r';
        i += 2;
        continue;
      }
      if (next === 't') {
        out += '\t';
        i += 2;
        continue;
      }
      if (next === '\\') {
        out += '\\';
        i += 2;
        continue;
      }
      if (next === '"') {
        out += '"';
        i += 2;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }
    if (ch === quote) return out;
    out += ch;
    i += 1;
  }
  return out;
}

export function serializeDotenv(lines: DotenvLine[]): string {
  const out = lines.map((line) => {
    if (line.type === 'blank') return '';
    if (line.type === 'comment') return line.raw;
    return formatKv(line.key, line.value);
  });
  return out.join('\n') + '\n';
}

function formatKv(key: string, value: string): string {
  const needsQuote = value === '' || /[\s#"\\]/.test(value) || value !== value.trim();
  if (!needsQuote) return `${key}=${value}`;
  const esc = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `${key}="${esc}"`;
}

export function dotenvKeys(lines: DotenvLine[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    if (line.type === 'kv' && !seen.has(line.key)) {
      seen.add(line.key);
      out.push(line.key);
    }
  }
  return out;
}

export function dotenvLookup(lines: DotenvLine[], key: string): string | undefined {
  let value: string | undefined;
  // Last definition wins, matching POSIX shell + dotenv conventions.
  for (const line of lines) {
    if (line.type === 'kv' && line.key === key) value = line.value;
  }
  return value;
}

export function dotenvSet(lines: DotenvLine[], key: string, value: string): DotenvLine[] {
  if (!VALID_KEY.test(key)) {
    throw new Error(`Invalid env var name "${key}" — must match ${VALID_KEY}.`);
  }
  let replaced = false;
  const out: DotenvLine[] = [];
  for (const line of lines) {
    if (line.type === 'kv' && line.key === key) {
      if (replaced) continue;
      replaced = true;
      out.push({ type: 'kv', key, value, raw: formatKv(key, value) });
    } else {
      out.push(line);
    }
  }
  if (!replaced) out.push({ type: 'kv', key, value, raw: formatKv(key, value) });
  return out;
}

export function dotenvExample(lines: DotenvLine[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    if (line.type === 'blank') {
      out.push('');
    } else if (line.type === 'comment') {
      out.push(line.raw);
    } else {
      if (seen.has(line.key)) continue;
      seen.add(line.key);
      out.push(`${line.key}=`);
    }
  }
  return out.join('\n') + '\n';
}
