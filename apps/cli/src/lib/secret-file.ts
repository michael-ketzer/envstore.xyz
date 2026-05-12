// Atomic write of a sensitive file with mode 0o600 every time.
//
// `writeFile`'s `mode` option is only honored when the file is being
// CREATED, not when it's being overwritten. That leaves a real hole on
// overwrites of a pre-existing file with loose perms (mode 0o644 from a
// default umask, an identity backup the user copied in by hand, an export
// target that already existed, etc.) — `writeFile` rewrites the bytes but
// keeps the old mode, so the secret briefly (or permanently, until the
// next chmod) lives with world-readable perms.
//
// The pattern below forces a fresh atomic create every time:
//   1. unlink — removes any pre-existing entry (including symlinks).
//      `unlink` does NOT follow symlinks; it removes the link itself, so
//      a hostile symlink in the way is removed rather than written
//      *through* to some attacker-controlled target.
//   2. open with O_WRONLY|O_CREAT|O_EXCL (Node's 'wx' flag string) — fails
//      with EEXIST if a symlink got planted at the path in the gap
//      between step 1 and now. We abort rather than writing the secret
//      through the attacker's link.
//   3. writeFile + fchmod on the file descriptor — the fchmod is a
//      belt-and-suspenders defense (fchmod operates on the opened inode,
//      never on a symlink) so even if the earlier guards somehow missed
//      something the resulting bytes aren't group/world-readable.

import { open, unlink } from 'node:fs/promises';

export async function writeSecretFile(
  path: string,
  content: string | Uint8Array,
): Promise<void> {
  try {
    await unlink(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  // 'wx' = O_WRONLY | O_CREAT | O_EXCL. Mode 0o600 is applied at
  // create-time, so the file is never world-readable.
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(content);
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
}
