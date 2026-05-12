// workspace-roles is a tiny module but it gates every privileged action.
// The role hierarchy (OWNER > ADMIN > MEMBER) is the load-bearing piece —
// a regression that swapped two ranks would silently elevate MEMBER to
// admin powers everywhere.
//
// We don't mock next/navigation here: doing so pollutes the module shape
// for other tests that transitively import workspace-roles (TDZ errors
// surface in those tests when the cached, partly-initialized module is
// reused). The function under test doesn't call notFound, so the bare
// import path through workspace-roles is enough.

import { describe, expect, mock, test } from 'bun:test';

import { makeDbMock } from '@/test/db-mock';

mock.module('server-only', () => ({}));
mock.module('@envstore/db', () => makeDbMock({ prisma: {} }));

const { hasAtLeastRole } = await import('./workspace-roles');

describe('hasAtLeastRole', () => {
  test('OWNER ≥ OWNER, ADMIN, MEMBER', () => {
    expect(hasAtLeastRole('OWNER', 'OWNER')).toBe(true);
    expect(hasAtLeastRole('OWNER', 'ADMIN')).toBe(true);
    expect(hasAtLeastRole('OWNER', 'MEMBER')).toBe(true);
  });

  test('ADMIN ≥ ADMIN, MEMBER but NOT OWNER', () => {
    expect(hasAtLeastRole('ADMIN', 'OWNER')).toBe(false);
    expect(hasAtLeastRole('ADMIN', 'ADMIN')).toBe(true);
    expect(hasAtLeastRole('ADMIN', 'MEMBER')).toBe(true);
  });

  test('MEMBER ≥ MEMBER only', () => {
    expect(hasAtLeastRole('MEMBER', 'OWNER')).toBe(false);
    expect(hasAtLeastRole('MEMBER', 'ADMIN')).toBe(false);
    expect(hasAtLeastRole('MEMBER', 'MEMBER')).toBe(true);
  });
});
