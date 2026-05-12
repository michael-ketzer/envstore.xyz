// Trust-on-first-use cache for the server-supplied recipient list.
//
// The threat: a compromised server could silently inject a recipient (an
// `age1…` it controls) into the `/api/v1/workspaces/<ws>/recipients` response.
// Push then encrypts to that recipient alongside legitimate ones, and the
// attacker can decrypt future env files even though existing ciphertext and
// the user's private key are safe.
//
// Mitigation: this module remembers the recipient set the user has already
// authorized (TOFU on first contact) and surfaces a diff on every subsequent
// push. New recipients require explicit acceptance — interactively, or via
// `--trust-new`. Removals are informational only; legitimate revocations
// shouldn't block a push.
//
// Storage: `~/.config/envstore/trust.json` (mode 0600). Local-only —
// committing the file would leak workspace/team structure. A future feature
// could add an opt-in committed fingerprint for teams that want shared trust
// state.

import { mkdir, readFile } from 'node:fs/promises';

import { configDir } from './paths';
import { writeSecretFile } from './secret-file';

const TRUST_FILE_VERSION = 1;

export type RecipientInfo = {
  id: string;
  recipient: string;
  kind: 'AGE_X25519' | 'SSH_ED25519' | 'SSH_RSA';
  label: string;
  // Member recipients carry the registered user's email; service-token
  // recipients have `userEmail: null` and a `token:<name>` label.
  userEmail: string | null;
};

export type TrustedProjectEntry = {
  recipients: string[];
  updatedAt: string;
};

export type TrustFile = {
  version: number;
  trust: Record<string, Record<string, Record<string, TrustedProjectEntry>>>;
};

import { join } from 'node:path';

export function trustFilePath(): string {
  return join(configDir(), 'trust.json');
}

function normalizeApiUrl(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, '');
}

function emptyTrustFile(): TrustFile {
  return { version: TRUST_FILE_VERSION, trust: {} };
}

export async function loadTrustFile(): Promise<TrustFile> {
  try {
    const raw = await readFile(trustFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      (parsed as TrustFile).version !== TRUST_FILE_VERSION ||
      typeof (parsed as TrustFile).trust !== 'object'
    ) {
      // Unrecognized shape — treat as a corrupt cache and start fresh.
      // We don't throw because that would block every push until the user
      // manually deletes the file.
      return emptyTrustFile();
    }
    return parsed as TrustFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyTrustFile();
    throw err;
  }
}

export async function saveTrustFile(file: TrustFile): Promise<void> {
  // The recipients themselves are public, but the trust file still leaks
  // workspace and project slugs (and its *integrity* matters — pre-poisoning
  // the cache would silently accept a malicious recipient on the next push).
  // writeSecretFile applies mode 0o600 atomically on every write, so the
  // structure stays as private as the rest of ~/.config/envstore.
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  await writeSecretFile(trustFilePath(), JSON.stringify(file, null, 2));
}

export function readTrust(
  file: TrustFile,
  apiUrl: string,
  workspace: string,
  project: string,
): TrustedProjectEntry | null {
  return file.trust[normalizeApiUrl(apiUrl)]?.[workspace]?.[project] ?? null;
}

export function writeTrust(
  file: TrustFile,
  apiUrl: string,
  workspace: string,
  project: string,
  recipients: string[],
): TrustFile {
  const key = normalizeApiUrl(apiUrl);
  // Recipients are stored sorted so the JSON file is stable across pushes —
  // makes manual inspection (and any future committed-fingerprint feature)
  // deterministic.
  const sorted = Array.from(new Set(recipients)).sort();
  const byWs = { ...(file.trust[key] ?? {}) };
  const byProj = { ...(byWs[workspace] ?? {}) };
  byProj[project] = { recipients: sorted, updatedAt: new Date().toISOString() };
  byWs[workspace] = byProj;
  return {
    ...file,
    trust: { ...file.trust, [key]: byWs },
  };
}

export function clearTrust(
  file: TrustFile,
  apiUrl: string,
  workspace: string | null,
  project: string | null,
): TrustFile {
  const key = normalizeApiUrl(apiUrl);
  const byWs = file.trust[key];
  if (!byWs) return file;
  if (workspace === null) {
    const next = { ...file.trust };
    delete next[key];
    return { ...file, trust: next };
  }
  const byProj = byWs[workspace];
  if (!byProj) return file;
  if (project === null) {
    const nextByWs = { ...byWs };
    delete nextByWs[workspace];
    return { ...file, trust: { ...file.trust, [key]: nextByWs } };
  }
  if (!byProj[project]) return file;
  const nextByProj = { ...byProj };
  delete nextByProj[project];
  const nextByWs = { ...byWs, [workspace]: nextByProj };
  return { ...file, trust: { ...file.trust, [key]: nextByWs } };
}

export type TrustDiff =
  | {
      status: 'first-contact';
      // First time we've seen this project; everything is "new" but accepted
      // implicitly (TOFU). Callers should log + save without prompting.
      serverSet: RecipientInfo[];
    }
  | {
      status: 'exact-match';
      // Server set is identical to the cached set. Silent.
      serverSet: RecipientInfo[];
    }
  | {
      status: 'changed';
      // Server set differs. `added` is the security-relevant subset — any
      // new recipient could be an injection. `removed` is informational.
      added: RecipientInfo[];
      removed: string[];
      known: RecipientInfo[];
      serverSet: RecipientInfo[];
    };

export function diffTrust(
  trusted: TrustedProjectEntry | null,
  serverRecipients: RecipientInfo[],
): TrustDiff {
  const serverSet = [...serverRecipients].sort((a, b) =>
    a.recipient.localeCompare(b.recipient),
  );

  if (!trusted) {
    return { status: 'first-contact', serverSet };
  }
  const trustedSet = new Set(trusted.recipients);
  const serverByRecipient = new Map(serverSet.map((r) => [r.recipient, r]));

  const added = serverSet.filter((r) => !trustedSet.has(r.recipient));
  const removed = trusted.recipients.filter((r) => !serverByRecipient.has(r));
  const known = serverSet.filter((r) => trustedSet.has(r.recipient));

  if (added.length === 0 && removed.length === 0) {
    return { status: 'exact-match', serverSet };
  }
  return { status: 'changed', added, removed, known, serverSet };
}

// Short label for an unfamiliar recipient — used in prompts so the user
// can decide whether the added entry corresponds to a real teammate or a
// suspicious injection. Keeps the user-email visible (the strongest signal),
// then label, then kind.
export function describeRecipient(r: RecipientInfo): string {
  const who = r.userEmail ?? '(service token)';
  return `${r.recipient}  ·  ${who}  ·  "${r.label}"  (${r.kind})`;
}

// Truncated recipient string for terse contexts (removed-recipients list
// where we only have the recipient bytes, not the label).
export function shortRecipient(recipient: string): string {
  if (recipient.length <= 24) return recipient;
  return `${recipient.slice(0, 16)}…${recipient.slice(-6)}`;
}

import { CliError } from './errors';
import { c, info, muted, warn } from './output';
import { askConfirm } from './prompt';

export type TrustLocation = {
  apiUrl: string;
  workspace: string;
  project: string;
};

export type TrustDecisionOpts = {
  // Auto-accept any newly-added recipients without prompting. Surfaced as
  // `envstore push --trust-new` for CI/automation. The trust cache is still
  // updated so subsequent runs see the new set as known.
  trustNew: boolean;
};

// Glue between `diffTrust` and the surrounding CLI command. Handles the
// four cases — silent match, TOFU-on-first-contact, removals-only, and
// security-sensitive additions — including the prompt for the last one.
// Returns nothing; throws CliError if the user (or automation policy) declined
// the new recipient set.
export async function applyTrustDecision(
  loc: TrustLocation,
  serverRecipients: RecipientInfo[],
  opts: TrustDecisionOpts,
): Promise<void> {
  const file = await loadTrustFile();
  const trusted = readTrust(file, loc.apiUrl, loc.workspace, loc.project);
  const diff = diffTrust(trusted, serverRecipients);

  const recipientStrings = serverRecipients.map((r) => r.recipient);
  const projectLabel = `${loc.workspace}/${loc.project}`;

  switch (diff.status) {
    case 'exact-match':
      // Steady state — nothing changed, nothing to log.
      return;

    case 'first-contact': {
      // TOFU. Print the trusted set so the user can verify out-of-band on
      // first push from this machine. Bypass behavior is intentional: we
      // don't ask, since blocking every first-push would punish the common
      // case (a freshly-onboarded teammate) without meaningful safety —
      // there's no prior set to diff against. The cache means subsequent
      // changes WILL be challenged.
      warn(
        `First push from this machine for ${c.cyan(projectLabel)}. ` +
          `Trusting ${serverRecipients.length} recipient${serverRecipients.length === 1 ? '' : 's'}:`,
      );
      for (const r of diff.serverSet) {
        console.log(`  ${c.gray('+')} ${describeRecipient(r)}`);
      }
      muted(
        '  Cached in ~/.config/envstore/trust.json. ' +
          'Future changes to this set will require confirmation.',
      );
      await saveTrustFile(writeTrust(file, loc.apiUrl, loc.workspace, loc.project, recipientStrings));
      return;
    }

    case 'changed': {
      if (diff.added.length === 0) {
        // Only removals — usually a token expired or a recipient was
        // revoked. Push proceeds; the new (smaller) set replaces the
        // cache silently after a one-line notice.
        info(
          `Recipient set for ${c.cyan(projectLabel)} shrank since your last push ` +
            `(${diff.removed.length} removed). Updating trust cache.`,
        );
        for (const r of diff.removed) {
          console.log(`  ${c.gray('-')} ${shortRecipient(r)}`);
        }
        await saveTrustFile(
          writeTrust(file, loc.apiUrl, loc.workspace, loc.project, recipientStrings),
        );
        return;
      }

      // The security-sensitive case: server is asking us to encrypt to a
      // recipient we've never seen for this project.
      warn(
        `Recipient set for ${c.cyan(projectLabel)} has changed since your last push.`,
      );
      console.log();
      console.log(
        `  ${c.bold(c.yellow(`${diff.added.length} new recipient${diff.added.length === 1 ? '' : 's'}`))} (please verify):`,
      );
      for (const r of diff.added) {
        console.log(`    ${c.yellow('+')} ${describeRecipient(r)}`);
      }
      if (diff.removed.length > 0) {
        console.log();
        console.log(`  ${diff.removed.length} removed:`);
        for (const r of diff.removed) {
          console.log(`    ${c.gray('-')} ${shortRecipient(r)}`);
        }
      }
      console.log();
      muted(
        '  A compromised server could inject a recipient to silently steal future pushes.',
      );
      muted(
        '  Check the dashboard or ask the team before accepting an unfamiliar entry.',
      );
      console.log();

      if (opts.trustNew) {
        info(`Auto-accepted (--trust-new). Updating trust cache.`);
        await saveTrustFile(
          writeTrust(file, loc.apiUrl, loc.workspace, loc.project, recipientStrings),
        );
        return;
      }

      if (!process.stdin.isTTY) {
        throw new CliError(
          `Recipient set for ${projectLabel} changed; this is a non-interactive run so I can't ask you to confirm.`,
          {
            hint:
              'Run `envstore push` from a workstation to review and accept the new recipients, ' +
              'or pass `--trust-new` if you have already reviewed them out-of-band.',
          },
        );
      }
      const accepted = askConfirm(
        `Encrypt to the new recipient set (${serverRecipients.length} total)?`,
        false,
      );
      if (!accepted) {
        throw new CliError('Push cancelled — recipient set not accepted.');
      }
      await saveTrustFile(
        writeTrust(file, loc.apiUrl, loc.workspace, loc.project, recipientStrings),
      );
      return;
    }
  }
}
