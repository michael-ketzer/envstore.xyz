// Best-effort `open <url>` across platforms. We don't error if it fails; the
// user can always copy the URL from the terminal.

import { spawn } from 'node:child_process';

export function openUrl(url: string): void {
  // The `apiUrl` field in envstore.json is operator-configurable; the
  // device-start response (which seeds the URL we open here) comes from
  // that endpoint. On Windows, going through `cmd /c start` exposes the
  // URL string to cmd.exe's argument parser, which historically had
  // quoting footguns (CVE-2024-27980-class). Use rundll32's
  // FileProtocolHandler instead — it hands the URL directly to the
  // registered protocol handler without a shell re-parse.
  let cmd: string;
  let args: string[];
  if (process.platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (process.platform === 'win32') {
    cmd = 'rundll32';
    args = ['url.dll,FileProtocolHandler', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.unref();
  } catch {
    // ignored — user copies URL from terminal
  }
}
