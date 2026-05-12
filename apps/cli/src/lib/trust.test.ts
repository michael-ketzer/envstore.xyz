import { describe, expect, test } from 'bun:test';

import {
  clearTrust,
  diffTrust,
  readTrust,
  writeTrust,
  type RecipientInfo,
  type TrustFile,
} from './trust';

function makeRecipient(over: Partial<RecipientInfo> & { recipient: string }): RecipientInfo {
  return {
    id: over.id ?? `id-${over.recipient}`,
    kind: over.kind ?? 'AGE_X25519',
    label: over.label ?? 'test',
    userEmail: over.userEmail ?? 'user@example.com',
    recipient: over.recipient,
  };
}

function emptyFile(): TrustFile {
  return { version: 1, trust: {} };
}

describe('diffTrust', () => {
  test('no cached entry → first-contact', () => {
    const server = [makeRecipient({ recipient: 'age1abc' })];
    const diff = diffTrust(null, server);
    expect(diff.status).toBe('first-contact');
    if (diff.status === 'first-contact') {
      expect(diff.serverSet).toHaveLength(1);
    }
  });

  test('identical sets → exact-match', () => {
    const server = [
      makeRecipient({ recipient: 'age1abc' }),
      makeRecipient({ recipient: 'age1def' }),
    ];
    const diff = diffTrust(
      { recipients: ['age1abc', 'age1def'], updatedAt: '2026-01-01' },
      server,
    );
    expect(diff.status).toBe('exact-match');
  });

  test('order does not matter — set equality wins', () => {
    const server = [
      makeRecipient({ recipient: 'age1def' }),
      makeRecipient({ recipient: 'age1abc' }),
    ];
    const diff = diffTrust(
      { recipients: ['age1abc', 'age1def'], updatedAt: '2026-01-01' },
      server,
    );
    expect(diff.status).toBe('exact-match');
  });

  test('server introduces a new recipient → changed with added', () => {
    const server = [
      makeRecipient({ recipient: 'age1abc' }),
      makeRecipient({ recipient: 'age1new', userEmail: 'mallory@example.com', label: 'sus' }),
    ];
    const diff = diffTrust(
      { recipients: ['age1abc'], updatedAt: '2026-01-01' },
      server,
    );
    expect(diff.status).toBe('changed');
    if (diff.status === 'changed') {
      expect(diff.added).toHaveLength(1);
      expect(diff.added[0]!.recipient).toBe('age1new');
      expect(diff.removed).toHaveLength(0);
      expect(diff.known).toHaveLength(1);
    }
  });

  test('server omits a previously trusted recipient → changed with removed only', () => {
    const server = [makeRecipient({ recipient: 'age1abc' })];
    const diff = diffTrust(
      { recipients: ['age1abc', 'age1gone'], updatedAt: '2026-01-01' },
      server,
    );
    expect(diff.status).toBe('changed');
    if (diff.status === 'changed') {
      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toEqual(['age1gone']);
    }
  });

  test('both added and removed → changed with both populated', () => {
    const server = [
      makeRecipient({ recipient: 'age1abc' }),
      makeRecipient({ recipient: 'age1new' }),
    ];
    const diff = diffTrust(
      { recipients: ['age1abc', 'age1gone'], updatedAt: '2026-01-01' },
      server,
    );
    expect(diff.status).toBe('changed');
    if (diff.status === 'changed') {
      expect(diff.added.map((r) => r.recipient)).toEqual(['age1new']);
      expect(diff.removed).toEqual(['age1gone']);
      expect(diff.known.map((r) => r.recipient)).toEqual(['age1abc']);
    }
  });
});

describe('readTrust / writeTrust', () => {
  test('readTrust returns null when no entry exists', () => {
    const file = emptyFile();
    expect(readTrust(file, 'https://envstore.xyz', 'team', 'web')).toBeNull();
  });

  test('writeTrust + readTrust roundtrip', () => {
    const file = writeTrust(emptyFile(), 'https://envstore.xyz', 'team', 'web', [
      'age1abc',
      'age1def',
    ]);
    const entry = readTrust(file, 'https://envstore.xyz', 'team', 'web');
    expect(entry).not.toBeNull();
    expect(entry!.recipients).toEqual(['age1abc', 'age1def']);
  });

  test('writeTrust sorts and dedupes recipients (stable file)', () => {
    const file = writeTrust(emptyFile(), 'https://envstore.xyz', 'team', 'web', [
      'age1def',
      'age1abc',
      'age1abc',
    ]);
    const entry = readTrust(file, 'https://envstore.xyz', 'team', 'web');
    expect(entry!.recipients).toEqual(['age1abc', 'age1def']);
  });

  test('apiUrl trailing slash is normalized away', () => {
    const file = writeTrust(emptyFile(), 'https://envstore.xyz/', 'team', 'web', ['age1abc']);
    // Both forms read the same entry.
    expect(readTrust(file, 'https://envstore.xyz', 'team', 'web')).not.toBeNull();
    expect(readTrust(file, 'https://envstore.xyz/', 'team', 'web')).not.toBeNull();
  });

  test('different apiUrls are isolated (self-hosting use case)', () => {
    let file = writeTrust(emptyFile(), 'https://a.example', 'team', 'web', ['age1abc']);
    file = writeTrust(file, 'https://b.example', 'team', 'web', ['age1xyz']);
    expect(readTrust(file, 'https://a.example', 'team', 'web')!.recipients).toEqual([
      'age1abc',
    ]);
    expect(readTrust(file, 'https://b.example', 'team', 'web')!.recipients).toEqual([
      'age1xyz',
    ]);
  });
});

describe('clearTrust', () => {
  function seeded(): TrustFile {
    let f = writeTrust(emptyFile(), 'https://envstore.xyz', 'team', 'web', ['age1abc']);
    f = writeTrust(f, 'https://envstore.xyz', 'team', 'api', ['age1def']);
    f = writeTrust(f, 'https://envstore.xyz', 'other-team', 'svc', ['age1xyz']);
    return f;
  }

  test('project-scope clear removes one project only', () => {
    const cleared = clearTrust(seeded(), 'https://envstore.xyz', 'team', 'web');
    expect(readTrust(cleared, 'https://envstore.xyz', 'team', 'web')).toBeNull();
    expect(readTrust(cleared, 'https://envstore.xyz', 'team', 'api')).not.toBeNull();
  });

  test('workspace-scope clear removes every project under the workspace', () => {
    const cleared = clearTrust(seeded(), 'https://envstore.xyz', 'team', null);
    expect(readTrust(cleared, 'https://envstore.xyz', 'team', 'web')).toBeNull();
    expect(readTrust(cleared, 'https://envstore.xyz', 'team', 'api')).toBeNull();
    expect(readTrust(cleared, 'https://envstore.xyz', 'other-team', 'svc')).not.toBeNull();
  });

  test('apiUrl-scope clear removes the whole instance', () => {
    const cleared = clearTrust(seeded(), 'https://envstore.xyz', null, null);
    expect(readTrust(cleared, 'https://envstore.xyz', 'team', 'web')).toBeNull();
    expect(readTrust(cleared, 'https://envstore.xyz', 'other-team', 'svc')).toBeNull();
  });

  test('clearing a missing entry is a no-op (idempotent)', () => {
    const file = seeded();
    const cleared = clearTrust(file, 'https://nothing.example', null, null);
    expect(cleared).toEqual(file);
  });
});
