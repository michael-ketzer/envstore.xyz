// Recipient string parsing + structural validation.
// Web-safe: no encryption operations, no private keys, no age library dep.
// (Real cryptographic validation happens inside age when the CLI actually encrypts.)

import { detectRecipientKind, type RecipientKind } from '@envstore/shared';

export type ParsedRecipient = {
  raw: string;
  kind: RecipientKind;
};

export class InvalidRecipientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRecipientError';
  }
}

// age recipients look like: age1<58 chars of bech32>
const AGE_RECIPIENT_RE = /^age1[0-9a-z]{58}$/;
// ssh-ed25519 AAAA<base64>(...) [optional comment]
const SSH_ED25519_RE = /^ssh-ed25519\s+[A-Za-z0-9+/=]+(\s+\S.*)?$/;
const SSH_RSA_RE = /^ssh-rsa\s+[A-Za-z0-9+/=]+(\s+\S.*)?$/;

export function parseRecipient(input: string): ParsedRecipient {
  const trimmed = input.trim();
  const kind = detectRecipientKind(trimmed);
  if (!kind) {
    throw new InvalidRecipientError(
      'Recipient must start with "age1", "ssh-ed25519 ", or "ssh-rsa ".',
    );
  }
  if (kind === 'AGE_X25519' && !AGE_RECIPIENT_RE.test(trimmed)) {
    throw new InvalidRecipientError('Malformed age1 recipient.');
  }
  if (kind === 'SSH_ED25519' && !SSH_ED25519_RE.test(trimmed)) {
    throw new InvalidRecipientError('Malformed ssh-ed25519 public key.');
  }
  if (kind === 'SSH_RSA' && !SSH_RSA_RE.test(trimmed)) {
    throw new InvalidRecipientError('Malformed ssh-rsa public key.');
  }
  return { raw: trimmed, kind };
}

export function tryParseRecipient(input: string): ParsedRecipient | null {
  try {
    return parseRecipient(input);
  } catch {
    return null;
  }
}

// Strip an optional trailing comment from an SSH key so display labels stay tidy.
export function shortenRecipient(recipient: string, maxChars = 28): string {
  const trimmed = recipient.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const head = trimmed.slice(0, maxChars - 3);
  return `${head}…`;
}
