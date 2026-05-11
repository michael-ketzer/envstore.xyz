// `envstore login` — OAuth 2.0 device-authorization grant.
// 1. POST /api/cli/device/start → deviceCode + userCode + verificationUri
// 2. Show userCode, open browser to verificationUri (with code pre-filled)
// 3. Poll /api/cli/device/poll until APPROVED, EXPIRED, or DENIED
// 4. Save the returned token in Keychain (or file fallback)

import { hostname, userInfo } from 'node:os';

import { DEFAULTS } from '@envstore/shared';

import { makeClient } from '../lib/api';
import type { Args } from '../lib/args';
import { openUrl } from '../lib/browser';
import { loadGlobalConfig, resolveApiUrl, saveGlobalConfig } from '../lib/config';
import { saveToken } from '../lib/creds';
import { CliError } from '../lib/errors';
import { c, info, muted, success } from '../lib/output';

type StartResponse = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

type PollResponse =
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'approved'; token: string }
  | { status: 'denied' }
  | { status: 'expired' };

function defaultClientName(): string {
  try {
    const user = userInfo().username || 'cli';
    return `${user}@${hostname()}`;
  } catch {
    return 'envstore-cli';
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function login(args: Args): Promise<void> {
  const apiUrl = await resolveApiUrl();
  const client = makeClient(apiUrl);
  const clientName =
    (typeof args.flags['name'] === 'string' && args.flags['name']) ||
    defaultClientName();

  info(`Signing in to ${c.cyan(apiUrl)}…`);
  const start = await client.postPublic<StartResponse>('/api/cli/device/start', {
    clientName,
  });

  console.log();
  console.log(`  Your one-time code: ${c.bold(c.cyan(start.userCode))}`);
  console.log(`  Open: ${c.cyan(start.verificationUriComplete)}`);
  console.log();
  muted('Waiting for approval in your browser… (Ctrl-C to cancel)');
  openUrl(start.verificationUriComplete);

  const deadline = Date.now() + start.expiresIn * 1000;
  let interval = Math.max(1, start.interval) * 1000;

  while (Date.now() < deadline) {
    await sleep(interval);
    const poll = await client.postPublic<PollResponse>('/api/cli/device/poll', {
      deviceCode: start.deviceCode,
    });

    if (poll.status === 'pending') continue;
    if (poll.status === 'slow_down') {
      interval = Math.max(interval, poll.interval * 1000);
      continue;
    }
    if (poll.status === 'denied') {
      throw new CliError('Access denied in the browser.', { exitCode: 3 });
    }
    if (poll.status === 'expired') {
      throw new CliError('That sign-in attempt expired.', {
        exitCode: 3,
        hint: 'Run `envstore login` again.',
      });
    }
    if (poll.status === 'approved') {
      await saveToken(apiUrl, poll.token);
      // Remember the API URL so subsequent commands don't need --api-url.
      // ENVSTORE_API_URL env var still wins, then envstore.json's apiUrl, then this.
      const global = await loadGlobalConfig();
      if (global.apiUrl !== apiUrl) {
        await saveGlobalConfig({ ...global, apiUrl });
      }
      success(`Signed in. Token stored ${c.gray('(macOS Keychain or ~/.config/envstore)')}`);
      muted(`API URL remembered (${apiUrl}). Run other commands without --api-url.`);
      muted(
        `Tip: run \`envstore identity init\` next to generate your local age identity,
     or \`envstore identity import <file>\` if you already have one.`,
      );
      return;
    }
  }

  throw new CliError('Timed out waiting for approval.', {
    exitCode: 3,
    hint: `Sign-in expires after ${DEFAULTS.deviceCodeExpiryMinutes} minutes.`,
  });
}
