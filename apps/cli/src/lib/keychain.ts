// macOS Keychain wrapper via `security`. Best-effort: if `security` isn't
// available (Linux, container, etc.) callers fall back to file storage.

import { spawn } from 'node:child_process';

export function isKeychainAvailable(): boolean {
  return process.platform === 'darwin';
}

function run(args: string[], stdin?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('security', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
    if (stdin !== undefined) {
      child.stdin.end(stdin);
    } else {
      child.stdin.end();
    }
  });
}

// `service` and `account` form the Keychain item key.
// `service` examples: "envstore.token", "envstore.identity"
// `account` examples: API URL (so multiple instances coexist), or "default"

export async function keychainSet(service: string, account: string, value: string): Promise<void> {
  // -U updates if exists; -s service; -a account; -w plaintext value.
  const { code, stderr } = await run(
    ['add-generic-password', '-U', '-s', service, '-a', account, '-w', value],
  );
  if (code !== 0) {
    throw new Error(`Keychain write failed: ${stderr.trim()}`);
  }
}

export async function keychainGet(service: string, account: string): Promise<string | null> {
  const { code, stdout, stderr } = await run(
    ['find-generic-password', '-s', service, '-a', account, '-w'],
  );
  if (code !== 0) {
    // 44 = not found; any other error we surface
    if (/could not be found/i.test(stderr) || code === 44) return null;
    throw new Error(`Keychain read failed: ${stderr.trim()}`);
  }
  return stdout.replace(/\n$/, '');
}

export async function keychainDelete(service: string, account: string): Promise<boolean> {
  const { code, stderr } = await run(
    ['delete-generic-password', '-s', service, '-a', account],
  );
  if (code === 0) return true;
  if (/could not be found/i.test(stderr) || code === 44) return false;
  throw new Error(`Keychain delete failed: ${stderr.trim()}`);
}
