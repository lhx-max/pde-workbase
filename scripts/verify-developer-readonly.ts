/** Real cloud ACL test using a fresh ordinary account, never an admin key as reader. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { cli: { type: 'string' }, 'config-dir': { type: 'string' }, 'output-dir': { type: 'string' } } });
for (const key of ['cli', 'config-dir', 'output-dir'] as const) if (!values[key] || !path.isAbsolute(values[key]!)) throw new Error(`${key} must be absolute`);
await mkdir(values['output-dir']!, { recursive: true, mode: 0o700 });
const exec = promisify(execFile), base = 'https://frontend-cloud.corp.kuaishou.com/v1';
const stamp = randomUUID().replaceAll('-', '').slice(0, 20), userId = `roprobe${stamp}`, documentId = `rotest${stamp}`;
const checks: Array<{ name: string; status: number }> = [];
let cookie = '', accountCreated = false;
const fixtures: Array<{ type: 'document' | 'file'; database?: string; collection?: string; bucket?: string; id: string }> = [];
async function admin(args: string[]): Promise<any> {
  try {
    const { stdout } = await exec(process.execPath, ['--import', 'data:text/javascript,BigInt.prototype.toJSON=function(){return%20String(this)}', values.cli!, ...args, '--json'], { cwd: values['config-dir'], timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(stdout.slice(stdout.indexOf('{')));
  } catch { throw new Error(`Admin ${args[0]} ${args[1]} failed (sensitive output suppressed)`); }
}
async function request(endpoint: string, method = 'GET', body?: unknown, authenticated = true) {
  return fetch(`${base}${endpoint}`, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: {
    'x-appwrite-project': 'grworkspace', ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(authenticated && cookie ? { cookie } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function expectStatus(name: string, response: Response, allowed: number[]) {
  checks.push({ name, status: response.status });
  if (!allowed.includes(response.status)) throw new Error(`${name} returned ${response.status}, expected ${allowed.join('/')}`);
}
try {
  const password = randomBytes(32).toString('base64url'), email = `${userId}@example.invalid`;
  const created = await request('/account', 'POST', { userId, email, password, name: 'Temporary read-only verification' }, false);
  await expectStatus('temporary ordinary reader account created', created, [201]); accountCreated = true;
  const session = await request('/account/sessions/email', 'POST', { email, password }, false);
  await expectStatus('ordinary account login', session, [201]);
  const fallback = session.headers.get('x-fallback-cookies');
  if (fallback) {
    const jar = JSON.parse(fallback); cookie = Object.entries(jar).map(([key, value]) => `${key}=${value}`).join('; ');
  }
  if (!cookie) cookie = session.headers.getSetCookie().map(value => value.split(';')[0]).filter(value => value?.startsWith('a_session_')).join('; ');
  if (!cookie) {
    const data = await session.json();
    if (data.secret) cookie = `a_session_grworkspace=${data.secret}`;
  }
  if (!cookie) throw new Error('No ordinary session credential; refusing to substitute administrator credentials');
  const me = await request('/account');
  await expectStatus('reader identity independently verified', me, [200]);
  if ((await me.json()).$id !== userId) throw new Error('Reader is not the temporary independent account');

  const payloads = [
    { database: 'canvas_app_dev', collection: 'canvases', data: { revision: 1, state: JSON.stringify({ nodes: [], edges: [], images: [] }) } },
    { database: 'doc_app_dev', collection: 'documents', data: { name: 'Isolated ACL verification', path: `permission-tests/${documentId}.md`, fileId: `test${stamp}`, size: 0, updatedAt: new Date().toISOString() } },
  ];
  for (const fixture of payloads) {
    await admin(['databases', 'create-document', '--database-id', fixture.database, '--collection-id', fixture.collection, '--document-id', documentId, '--data', JSON.stringify(fixture.data)]);
    fixtures.push({ type: 'document', id: documentId, database: fixture.database, collection: fixture.collection });
    const endpoint = `/databases/${fixture.database}/collections/${fixture.collection}/documents`;
    await expectStatus(`${fixture.database}: authenticated default read`, await request(`${endpoint}/${documentId}`), [200]);
    // Appwrite may conceal an inaccessible resource as 404 rather than disclose existence.
    await expectStatus(`${fixture.database}: anonymous denied`, await request(`${endpoint}/${documentId}`, 'GET', undefined, false), [401, 403, 404]);
    const attemptedId = `denied${stamp}`;
    const attempted = await request(endpoint, 'POST', { documentId: attemptedId, data: fixture.data });
    if (attempted.ok) fixtures.push({ type: 'document', id: attemptedId, database: fixture.database, collection: fixture.collection });
    await expectStatus(`${fixture.database}: create denied`, attempted, [401, 403]);
    const changedData = fixture.collection === 'canvases' ? { revision: 2 } : { name: 'Reader must not change this fixture' };
    await expectStatus(`${fixture.database}: update denied`, await request(`${endpoint}/${documentId}`, 'PATCH', { data: changedData }), [401, 403]);
    await expectStatus(`${fixture.database}: delete denied`, await request(`${endpoint}/${documentId}`, 'DELETE'), [401, 403]);
    const current = await admin(['databases', 'get-document', '--database-id', fixture.database, '--collection-id', fixture.collection, '--document-id', documentId]);
    for (const [key, value] of Object.entries(fixture.data)) if (current[key] !== value) throw new Error('Reader changed isolated fixture');
  }
  const filePath = path.join(values['output-dir']!, 'isolated-acl-fixture.txt');
  await writeFile(filePath, 'Isolated permission verification. No user data.\n', { mode: 0o600 });
  for (const bucket of ['canvas_assets_v2', 'doc_assets_v2']) {
    await admin(['storage', 'create-file', '--bucket-id', bucket, '--file-id', documentId, '--file', filePath]);
    fixtures.push({ type: 'file', id: documentId, bucket });
    const endpoint = `/storage/buckets/${bucket}/files/${documentId}`;
    await expectStatus(`${bucket}: file readable`, await request(`${endpoint}/download`), [200]);
    await expectStatus(`${bucket}: anonymous file denied`, await request(`${endpoint}/download`, 'GET', undefined, false), [401, 403, 404]);
    await expectStatus(`${bucket}: file update denied`, await request(endpoint, 'PUT', { name: 'must-not-change.txt' }), [401, 403]);
    await expectStatus(`${bucket}: file delete denied`, await request(endpoint, 'DELETE'), [401, 403]);
    const upload = new FormData(); upload.set('fileId', `denied${stamp}`); upload.set('file', new Blob(['denied']), 'denied.txt');
    const uploaded = await fetch(`${base}/storage/buckets/${bucket}/files`, { method: 'POST', headers: { 'x-appwrite-project': 'grworkspace', cookie }, body: upload, signal: AbortSignal.timeout(15000) });
    if (uploaded.ok) fixtures.push({ type: 'file', id: `denied${stamp}`, bucket });
    await expectStatus(`${bucket}: upload denied`, uploaded, [401, 403]);
  }
  for (const id of ['canvas-coi', 'doc-api']) await expectStatus(`${id}: writer function execution denied`, await request(`/functions/${id}/executions`, 'POST', { async: false, path: '/api/apps', method: 'GET', body: '' }), [401, 403]);
  await writeFile(path.join(values['output-dir']!, 'reader-verification.json'), JSON.stringify({ passed: true, verifiedAt: new Date().toISOString(), readerUserId: userId, authentication: 'fresh ordinary account/session; no admin key', checks }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ passed: true, checks: checks.length }));
} catch (error) {
  await writeFile(path.join(values['output-dir']!, 'reader-verification.json'), JSON.stringify({ passed: false, readerUserId: userId, checks, error: error instanceof Error ? error.message : 'verification failed' }, null, 2), { mode: 0o600 });
  throw error;
} finally {
  const cleanup: Array<{ target: string; removed: boolean }> = [];
  for (const fixture of fixtures.reverse()) {
    try {
      await admin(fixture.type === 'document' ? ['databases', 'delete-document', '--database-id', fixture.database!, '--collection-id', fixture.collection!, '--document-id', fixture.id] : ['storage', 'delete-file', '--bucket-id', fixture.bucket!, '--file-id', fixture.id]);
      cleanup.push({ target: `${fixture.database ?? fixture.bucket}/${fixture.collection ?? ''}/${fixture.id}`, removed: true });
    } catch { cleanup.push({ target: fixture.id, removed: false }); }
  }
  if (cookie) {
    const disabled = await request('/account/status', 'PATCH');
    cleanup.push({ target: 'temporary-account-disabled', removed: disabled.ok });
    const logout = await request('/account/sessions/current', 'DELETE');
    cleanup.push({ target: 'temporary-session-revoked', removed: logout.ok || logout.status === 401 });
  }
  await writeFile(path.join(values['output-dir']!, 'cleanup.json'), JSON.stringify({ accountCreated, temporaryUserId: userId, cleanup }, null, 2), { mode: 0o600 });
}
