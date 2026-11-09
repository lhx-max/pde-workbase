import { test, expect } from 'vitest';
import { request } from 'node:https';
import { mkdir, mkdtemp, readFile, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { repositoryRoot, resolveWebBuildDirectory } from '../lib/tools-dev/runtime.js';
import { startMfProtocolFixture } from '../lib/tools-dev/mf-fixture.js';

test('isolated web-build option only accepts one named .tmp directory', () => {
  expect(resolveWebBuildDirectory(undefined)).toBeUndefined();
  expect(resolveWebBuildDirectory('.tmp/mf-web-build')).toBe('.tmp/mf-web-build');
  for (const value of ['', '.next', '../.tmp/build', '/tmp/build', '.tmp/../.next', '.tmp/name/nested', '.tmp/name?x', '.tmp/']) {
    expect(() => resolveWebBuildDirectory(value)).toThrow('must be .tmp/<name>');
  }
});

test('owned fixture uses verified HTTPS and a private explicitly fake cookie', async () => {
  const parent = path.join(repositoryRoot, '.tmp', 'e2e-runs');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, 'mf-protocol-'));
  const ownedRoot = await realpath(root);
  const fixture = await startMfProtocolFixture(root);
  try {
    const cookieFile = fixture.environment.CANVAS_MF_COOKIE_FILE!;
    expect((await stat(cookieFile)).mode & 0o777).toBe(0o600);
    const cookie = await readFile(cookieFile, 'utf8');
    expect(cookie).toContain('NOT_A_REAL_CREDENTIAL');
    expect(fixture.environment.NODE_TLS_REJECT_UNAUTHORIZED).toBeUndefined();
    const ca = await readFile(fixture.environment.NODE_EXTRA_CA_CERTS!);
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(`${fixture.url}/api/kpandora/v1/login/user`, { ca, headers: { Cookie: cookie } }, res => {
        let body = ''; res.setEncoding('utf8'); res.on('data', data => { body += data; });
        res.on('end', () => resolve({ status: res.statusCode!, body }));
      }); req.once('error', reject); req.end();
    });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body).result.username).toBe('canvas-e2e-user');
    expect(fixture.requests[0]?.authenticated).toBe(true);
  } finally {
    await fixture.dispose();
    const resolved = await realpath(root);
    if (resolved !== ownedRoot || path.dirname(resolved) !== await realpath(parent)) throw new Error('Refusing fixture cleanup outside owned scratch');
    await rm(resolved, { recursive: true, force: true });
  }
});
