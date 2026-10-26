import { expect, test } from 'bun:test';

test('Letterpier mail contract uses the real SDK without making network requests', async () => {
  // Other suites mock @/lib/email. A separate process tests the real module
  // without sharing Bun's module mock cache with OTP and invitation tests.
  const child = Bun.spawn(
    [process.execPath, 'run', new URL('../../test/email-contract.ts', import.meta.url).pathname],
    {
      cwd: import.meta.dir,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect({ status, stdout, stderr }).toEqual({ status: 0, stdout: '', stderr: '' });
});
