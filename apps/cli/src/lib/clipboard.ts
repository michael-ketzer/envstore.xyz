// Best-effort clipboard read/write. Returns null/false if no usable clipboard
// tool is found (headless Linux, etc.). We don't throw — callers fall back to
// stdin or stdout as appropriate.

import { spawn } from 'node:child_process';

const writeMac = { cmd: 'pbcopy', args: [] as string[] };
const writeWin = { cmd: 'clip', args: [] as string[] };
// Linux write: prefer wl-copy (Wayland), fall back to xclip (X11), then xsel.
const writeLinuxOptions: Array<{ cmd: string; args: string[] }> = [
  { cmd: 'wl-copy', args: [] },
  { cmd: 'xclip', args: ['-selection', 'clipboard'] },
  { cmd: 'xsel', args: ['--clipboard', '--input'] },
];

const readMac = { cmd: 'pbpaste', args: [] as string[] };
const readWin = { cmd: 'powershell', args: ['-NoProfile', '-Command', 'Get-Clipboard'] };
const readLinuxOptions: Array<{ cmd: string; args: string[] }> = [
  { cmd: 'wl-paste', args: [] },
  { cmd: 'xclip', args: ['-selection', 'clipboard', '-o'] },
  { cmd: 'xsel', args: ['--clipboard', '--output'] },
];

async function tryWrite(cmd: string, args: string[], value: string): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    } catch {
      resolve(false);
      return;
    }
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
    try {
      child.stdin.end(value);
    } catch {
      resolve(false);
    }
  });
}

async function tryRead(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }
    let stdout = '';
    child.stdout?.on('data', (d) => {
      stdout += d.toString();
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? stdout : null));
  });
}

export async function copyToClipboard(value: string): Promise<boolean> {
  if (process.platform === 'darwin') {
    return tryWrite(writeMac.cmd, writeMac.args, value);
  }
  if (process.platform === 'win32') {
    return tryWrite(writeWin.cmd, writeWin.args, value);
  }
  for (const { cmd, args } of writeLinuxOptions) {
    if (await tryWrite(cmd, args, value)) return true;
  }
  return false;
}

export async function readFromClipboard(): Promise<string | null> {
  if (process.platform === 'darwin') {
    return tryRead(readMac.cmd, readMac.args);
  }
  if (process.platform === 'win32') {
    return tryRead(readWin.cmd, readWin.args);
  }
  for (const { cmd, args } of readLinuxOptions) {
    const value = await tryRead(cmd, args);
    if (value !== null) return value;
  }
  return null;
}
