/** Real cloud Function -> database/bucket verification. Only isolated fixtures are written. */
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const exec = promisify(execFile);
const { values } = parseArgs({ options: { cli: { type: 'string' }, 'config-dir': { type: 'string' }, 'output-dir': { type: 'string' } } });
for (const key of ['cli', 'config-dir', 'output-dir'] as const) if (!values[key] || !path.isAbsolute(values[key]!)) throw Error(`${key} must be absolute`);
const project = JSON.parse(await readFile(path.join(values['config-dir']!, 'appwrite-cf.config.json'), 'utf8'));
if (project.projectId !== 'grworkspace') throw Error('Only the configured development project is supported');
await mkdir(values['output-dir']!, { recursive: true });
async function cli(args: string[]): Promise<Record<string, any>> {
  const result = await exec(process.execPath, ['--import', 'data:text/javascript,BigInt.prototype.toJSON=function(){return%20String(this)}', values.cli!, ...args, '--json'],
    { cwd: values['config-dir'], timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
}
const id = `cloudcheck-${Date.now()}`;
const checks: Array<{ name: string; passed: boolean }> = [];
const calls: Array<{ method: string; route: string; status: number; error?: unknown }> = [];
const cleanup: Array<{ target: string; deleted: boolean }> = [];
function check(name: string, ok: boolean): void { checks.push({ name, passed: ok }); if (!ok) throw Error(name); }
async function invoke(method: string, route: string, body?: unknown, key?: string) {
  const execution = await cli(['functions', 'create-execution', '--function-id', 'canvas-coi', '--method', method, '--path', route,
    '--body', body === undefined ? '' : JSON.stringify(body), '--async', 'false',
    '--headers', JSON.stringify(key ? { 'idempotency-key': key } : {})]);
  if (execution.status !== 'completed') throw Error('Cloud execution did not complete');
  const status = execution.responseStatusCode as number;
  const response = JSON.parse(execution.responseBody as string);
  calls.push({ method, route, status, ...(response.error ? { error: { code: response.error.code, message: response.error.message } } : {}) });
  return { status, body: response };
}
let failure: string | undefined;
try {
  const manifest = await invoke('GET', '/api/apps/canvas');
  check('Cloud capability endpoint', manifest.status === 200 && manifest.body.data?.appId === 'canvas');
  const created = await invoke('POST', '/api/apps/canvas/actions/canvas.create', { input: { instanceId: id } });
  check('Create isolated cloud canvas', created.status === 201);
  const initial = await invoke('GET', `/api/apps/canvas/instances/${id}/state`);
  check('Read initial cloud state', initial.status === 200 && initial.body.data?.revision === 1);
  const node = { id: 'probe-text', kind: 'text', title: 'Cloud verification', text: `Cloud canvas initial ${id}`, x: 0, y: 0 };
  const request = { input: { node }, expectedRevision: 1 };
  const applied = await invoke('POST', `/api/apps/canvas/instances/${id}/actions/node.create`, request, `${id}-create`);
  check('Create text card through cloud Function', applied.status === 200);
  const revision = applied.body.data.revision;
  const replay = await invoke('POST', `/api/apps/canvas/instances/${id}/actions/node.create`, request, `${id}-create`);
  check('Replay returns original receipt', replay.status === 200 && replay.body.data.replayed === true && replay.body.data.revision === revision);
  const finalText = `Verified Appwrite save and fresh-execution recovery ${id}`;
  const updated = await invoke('POST', `/api/apps/canvas/instances/${id}/actions/node.update`,
    { input: { nodeId: node.id, set: { text: finalText } }, expectedRevision: revision }, `${id}-update`);
  check('Edit card through cloud Function', updated.status === 200);
  const stale = await invoke('POST', `/api/apps/canvas/instances/${id}/actions/node.rename`,
    { input: { nodeId: node.id, title: 'Must reject' }, expectedRevision: 1 }, `${id}-stale`);
  check('Reject stale write', stale.status === 409);
  const fresh = await invoke('GET', `/api/apps/canvas/instances/${id}/state`);
  const nodes = fresh.body.data?.state?.workbenchBasicNodes ?? [];
  check('New Function execution recovers exact saved state', fresh.status === 200 && nodes.length === 1 && nodes[0].text === finalText);
  const stored = await cli(['databases', 'get-document', '--database-id', 'canvas_app_dev', '--collection-id', 'canvases', '--document-id', id]);
  check('Independent database readback', JSON.parse(stored.state).workbenchBasicNodes[0].text === finalText);
  const files = await cli(['databases', 'list-documents', '--database-id', 'canvas_app_dev', '--collection-id', 'canvas_files', '--queries', JSON.stringify({ method: 'equal', attribute: 'canvasId', values: [id] })]);
  check('Cloud text file indexed', files.documents.length > 0);
  const row = files.documents.find((item: Record<string, unknown>) => item.path === nodes[0].projectFilePath);
  check('Current card points to indexed cloud file', Boolean(row));
  const destination = path.join(values['output-dir']!, 'fixture-content.txt');
  await exec(process.execPath, [values.cli!, 'storage', 'get-file-download', '--bucket-id', 'canvas_assets_v2', '--file-id', row.fileId, '--destination', destination], { cwd: values['config-dir'], timeout: 30000 });
  const bytes = await readFile(destination);
  check('Bucket bytes match edited text', bytes.toString() === finalText && createHash('sha256').update(bytes).digest('hex') === row.sha256);
  await rm(destination);
} catch (error) {
  // CLI exceptions can contain unrelated credentials in raw stdout/stderr.
  failure = error instanceof Error && checks.some(item => item.name === error.message) ? error.message : 'Cloud execution, storage, transport or response verification failed';
} finally {
  const remove = async (target: string, args: string[]) => {
    try { await cli(args); cleanup.push({ target, deleted: true }); } catch { cleanup.push({ target, deleted: false }); }
  };
  for (const collection of ['canvas_files', 'canvas_operations']) {
    try {
      const rows = await cli(['databases', 'list-documents', '--database-id', 'canvas_app_dev', '--collection-id', collection, '--queries', JSON.stringify({ method: 'equal', attribute: 'canvasId', values: [id] }), JSON.stringify({ method: 'limit', values: [5000] })]);
      if (rows.total !== rows.documents.length) throw Error('Incomplete cleanup listing');
      for (const row of rows.documents) {
        if (row.fileId) await remove(`file:${row.fileId}`, ['storage', 'delete-file', '--bucket-id', 'canvas_assets_v2', '--file-id', row.fileId]);
        await remove(`${collection}:${row.$id}`, ['databases', 'delete-document', '--database-id', 'canvas_app_dev', '--collection-id', collection, '--document-id', row.$id]);
      }
    } catch { cleanup.push({ target: collection, deleted: false }); }
  }
  try {
    const rows = await cli(['databases', 'list-documents', '--database-id', 'canvas_app_dev', '--collection-id', 'canvases', '--queries', JSON.stringify({ method: 'equal', attribute: '$id', values: [id] })]);
    if (rows.total === 0) cleanup.push({ target: `canvases:${id} (verified absent)`, deleted: true });
    else await remove(`canvases:${id}`, ['databases', 'delete-document', '--database-id', 'canvas_app_dev', '--collection-id', 'canvases', '--document-id', id]);
  } catch { cleanup.push({ target: `canvases:${id}`, deleted: false }); }
  const report = { checkedAt: new Date().toISOString(), instanceId: id, surface: 'deployed canvas-coi Function; does not prove current browser uses cloud', passed: !failure && cleanup.every(item => item.deleted), checks, calls, cleanup, ...(failure ? { failure } : {}) };
  await writeFile(path.join(values['output-dir']!, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  if (!report.passed) process.exitCode = 1;
}
