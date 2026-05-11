// `envstore logout` — deletes the local token. The server-side revoke happens
// only if the server is reachable; otherwise we still wipe the local copy so
// the user can't authenticate from this machine.

import { makeClient } from '../lib/api';
import type { Args } from '../lib/args';
import { resolveApiUrl } from '../lib/config';
import { deleteToken } from '../lib/creds';
import { c, info, muted, warn } from '../lib/output';

export async function logout(_args: Args): Promise<void> {
  const apiUrl = await resolveApiUrl();

  // Best-effort server-side revoke. Don't fail logout if the server is down.
  try {
    const client = makeClient(apiUrl);
    await client.del('/api/v1/auth/cli/session');
  } catch (err) {
    warn(`Could not revoke server-side (${(err as Error).message}). Wiping local token anyway.`);
  }

  const removed = await deleteToken(apiUrl);
  if (removed) {
    info(`${c.green('✓')} Signed out of ${apiUrl}.`);
  } else {
    muted(`No local token for ${apiUrl}.`);
  }
}
