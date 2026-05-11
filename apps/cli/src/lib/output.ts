// Tiny ANSI helpers — keeps the CLI binary lean (no chalk/picocolors).

const isatty = process.stdout.isTTY === true && process.env.NO_COLOR !== '1';
const wrap = (code: string) => (s: string | number) =>
  isatty ? `\x1b[${code}m${s}\x1b[0m` : String(s);

export const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  magenta: wrap('35'),
  cyan: wrap('36'),
  gray: wrap('90'),
};

export function info(msg: string): void {
  console.log(msg);
}

export function success(msg: string): void {
  console.log(`${c.green('✓')} ${msg}`);
}

export function warn(msg: string): void {
  console.warn(`${c.yellow('!')} ${msg}`);
}

export function error(msg: string): void {
  console.error(`${c.red('✗')} ${msg}`);
}

export function heading(msg: string): void {
  console.log(c.bold(msg));
}

export function muted(msg: string): void {
  console.log(c.gray(msg));
}
