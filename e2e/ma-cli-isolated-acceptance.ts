// Explicit local integration acceptance. Creates only a unique synthetic tenant and archives its resources.
// Run: pnpm exec tsx e2e/ma-cli-isolated-acceptance.ts --local-test --output-dir /absolute/test-evidence
// Drives the real canvas-workspace CLI (apps call) against loopback sketch:19465 / doc:19464.
// All resources are newly created under a unique tenant; nothing pre-existing is touched.
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {mkdirSync} from 'node:fs';

const {values} = parseArgs({options:{'local-test':{type:'boolean'},'output-dir':{type:'string'},'port-base':{type:'string',default:'19463'}}});
if (!values['local-test'] || process.env.NODE_ENV === 'production') throw Error('Explicit --local-test required; production forbidden');
if (process.versions.node.split('.')[0] !== '24') throw Error('Use Node 24');
const output = values['output-dir'];
if (!output || !path.isAbsolute(output)) throw Error('Pass an absolute --output-dir for isolated evidence');
const port = Number(values['port-base']);
if (!Number.isInteger(port) || port < 1024 || port > 65532) throw Error('Invalid loopback port base');
const NODE = process.execPath;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKETCH = `http://127.0.0.1:${port + 2}`;
const DOC = `http://127.0.0.1:${port + 1}`;
mkdirSync(output, {recursive:true});
const WORK = mkdtempSync(path.join(output, 'ma-cli-'));
const RUN = `devin-verify-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
const TENANT = `${RUN}-tenant`;
const ACTOR = 'cli-tester';
const tmp = mkdtempSync(path.join(WORK, 'root-inputs-'));

const assertions: any[] = [];
const commands: any[] = [];
const limitations: string[] = [];
const evidence: any = { run: RUN, tenant: TENANT };

function sha256(b: Buffer | string) { return createHash('sha256').update(b).digest('hex'); }
function body(name: string, input: object) { const f = path.join(tmp, name); writeFileSync(f, JSON.stringify(input)); return f; }
function assert(name: string, level: string, ok: boolean, detail: unknown) {
  assertions.push({ name, level, ok, detail });
  if (!ok) console.error(`ASSERT FAIL [${level}] ${name}: ${JSON.stringify(detail)}`);
}

function cli(app: 'sketch' | 'doc', action: string, opts: { instance?: string; bodyFile?: string; key?: string }) {
  const args = ['--import', 'tsx', 'apps/server/src/cli.ts', 'apps', 'call', app, action,
    '--server-url', app === 'sketch' ? SKETCH : DOC,
    '--tenant', TENANT, '--actor', ACTOR];
  if (opts.instance) args.push('--instance', opts.instance);
  if (opts.bodyFile) args.push('--body-file', opts.bodyFile);
  if (opts.key) args.push('--idempotency-key', opts.key);
  const r = spawnSync(NODE, args, { cwd: REPO, encoding: 'utf8', timeout: 20000, env:{PATH:process.env.PATH ?? '', TMPDIR:WORK} });
  commands.push({ level: 'public-cli', argv: `node --import tsx apps/server/src/cli.ts ${args.slice(3).join(' ')}`, exit: r.status });
  let parsed: any = null;
  try { parsed = JSON.parse(r.stdout); } catch { parsed = { rawStdout: r.stdout.slice(0, 500) }; }
  return { exit: r.status, stdout: parsed, stderr: r.stderr?.slice(0, 500) };
}

async function httpGet(url: string) {
  const res = await fetch(url, { headers: { 'x-team-id': TENANT, 'x-user-id': ACTOR }, signal:AbortSignal.timeout(15000) });
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
}

// --- PNG fixture: real 32x24 PNG produced by the repo's sharp ---
let sharpPath: string | null = null;
const pnpm = path.join(REPO, 'node_modules/.pnpm');
for (const d of readdirSync(pnpm).filter(d => d.startsWith('sharp@')).sort()) {
  const p = path.join(pnpm, d, 'node_modules/sharp/lib/index.js');
  if (existsSync(p)) { sharpPath = p; break; }
}
if (!sharpPath) throw new Error('sharp not found in canvas-workspace .pnpm store');
const sharp = (await import(pathToFileURL(sharpPath).href)).default;
const png: Buffer = await sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();
const pngSha = sha256(png);
assert('png-fixture-valid', 'fixture', png.length > 60 && png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), { bytes: png.length, sha256: pngSha });

const scene = JSON.stringify({ type: 'excalidraw', version: 2, source: 'verify', elements: [{ id: 'e1', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }], appState: {}, files: {} });
const nodeId = `${RUN}-node`, mirrorCanvasId = `${RUN}-canvas`, mirrorPath = `mirrors/${RUN}/sketch.sketch.json`;

// ============ 1. sketch.bind ============
const createRes = cli('sketch', 'sketch.create', { bodyFile: body('sc.json', { name: `${RUN}-sketch`, content: scene }), key: `${RUN}-create` });
assert('sketch.create ok', 'public-cli', createRes.exit === 0 && createRes.stdout?.data?.result?.instanceId, createRes.stdout);
const sketchId = createRes.stdout?.data?.result?.instanceId;
evidence.sketchId = sketchId;

const bindRes = cli('sketch', 'sketch.bind', { instance: sketchId, bodyFile: body('bind.json', { nodeId, mirrorCanvasId, mirrorPath }), key: `${RUN}-bind` });
const bindMeta = bindRes.stdout?.data?.result?.meta;
assert('sketch.bind ok + meta fields', 'public-cli', bindRes.exit === 0 && bindMeta?.nodeId === nodeId && bindMeta?.mirrorCanvasId === mirrorCanvasId && bindMeta?.mirrorPath === mirrorPath, { meta: bindMeta });
evidence.bindBinding = bindRes.stdout?.data?.result?.binding;
limitations.push('binding.status=' + JSON.stringify(bindRes.stdout?.data?.result?.binding) + ' reflects only local record + optional canvas origin report; not asserted as real Canvas sync');

const readRes = cli('sketch', 'sketch.read', { instance: sketchId });
const readMeta = readRes.stdout?.data?.result?.meta;
assert('sketch.read meta persisted binding', 'readback', readRes.exit === 0 && readMeta?.nodeId === nodeId && readMeta?.mirrorCanvasId === mirrorCanvasId && readMeta?.mirrorPath === mirrorPath, { meta: readMeta });
assert('sketch.read content intact', 'readback', readRes.stdout?.data?.result?.content === scene, { revision: readRes.stdout?.data?.result?.revision });

const bindReplay = cli('sketch', 'sketch.bind', { instance: sketchId, bodyFile: body('bind.json', { nodeId, mirrorCanvasId, mirrorPath }), key: `${RUN}-bind` });
assert('bind same-key replay no duplicate', 'public-cli', bindReplay.exit === 0 && bindReplay.stdout?.data?.replayed === true && bindReplay.stdout?.data?.receiptId === bindRes.stdout?.data?.receiptId, bindReplay.stdout?.data);

const createReplay = cli('sketch', 'sketch.create', { bodyFile: body('sc.json', { name: `${RUN}-sketch`, content: scene }), key: `${RUN}-create` });
assert('create same-key replay same instance', 'public-cli', createReplay.exit === 0 && createReplay.stdout?.data?.replayed === true && createReplay.stdout?.data?.result?.instanceId === sketchId, createReplay.stdout?.data);

const bindBad = cli('sketch', 'sketch.bind', { instance: sketchId, bodyFile: body('bind-no-node.json', { mirrorCanvasId }), key: `${RUN}-bind-bad` });
assert('bind missing nodeId rejected', 'public-cli', bindBad.exit !== 0 && bindBad.stdout?.error?.code === 'BAD_REQUEST', { exit: bindBad.exit, stdout: bindBad.stdout });

// ============ 2. sketch.export-image ============
const fileName = `${RUN}-export.png`;
const expRes = cli('sketch', 'sketch.export-image', { instance: sketchId, bodyFile: body('exp.json', { base64: png.toString('base64'), fileName }), key: `${RUN}-export` });
const expResult = expRes.stdout?.data?.result;
assert('export-image ok returns file', 'public-cli', expRes.exit === 0 && typeof expResult?.fileName === 'string' && typeof expResult?.url === 'string', expRes.stdout);
evidence.exportResult = expResult;
limitations.push('export-image stores caller-supplied PNG bytes (SKILL: not server-side scene rendering); verified as file storage + download only');

if (expResult?.url) {
  const dl = await httpGet(new URL(expResult.url, SKETCH).toString());
  commands.push({ level: 'loopback-http', argv: `GET ${expResult.url} (x-team-id/x-user-id headers)`, exit: dl.status });
  assert('export download 200 + bytes match', 'loopback-http', dl.status === 200 && dl.bytes.equals(png), { status: dl.status, bytes: dl.bytes.length });
  const decoded = await sharp(dl.bytes).metadata();
  assert('download decoded 32x24 PNG', 'readback', decoded.width === 32 && decoded.height === 24 && decoded.format === 'png', { width: decoded.width, height: decoded.height, format: decoded.format });
  assert('export download sha256 match', 'loopback-http', sha256(dl.bytes) === pngSha, { expected: pngSha, actual: sha256(dl.bytes) });
}

const expBad = cli('sketch', 'sketch.export-image', { instance: sketchId, bodyFile: body('exp-bad.json', { fileName: 'x.png' }), key: `${RUN}-export-bad` });
assert('export-image missing base64 rejected', 'public-cli', expBad.exit !== 0 && expBad.stdout?.error?.code === 'SKETCH_INVALID_IMAGE', { exit: expBad.exit, stdout: expBad.stdout });

// ============ 3. doc.retryMirror ============
const docCreate = cli('doc', 'doc.create', { bodyFile: body('dc.json', { name: `${RUN}-doc`, content: `# ${RUN}\nbody text` }), key: `${RUN}-doc-create` });
assert('doc.create ok', 'public-cli', docCreate.exit === 0 && docCreate.stdout?.data?.result?.instanceId, docCreate.stdout);
const docId = docCreate.stdout?.data?.result?.instanceId;
evidence.docId = docId;

const docReadBefore = cli('doc', 'doc.read', { instance: docId });
const before = docReadBefore.stdout?.data?.result;
assert('doc.read before', 'readback', docReadBefore.exit === 0 && typeof before?.revision === 'string', { revision: before?.revision });
evidence.docBefore = { revision: before?.revision, contentSha: sha256(before?.content ?? '') };

const retry = cli('doc', 'doc.retryMirror', { instance: docId, bodyFile: body('retry.json', {}), key: `${RUN}-retry` });
const retryErr = retry.stdout?.error;
assert('retryMirror nonzero exit', 'public-cli', retry.exit !== 0, { exit: retry.exit });
assert('retryMirror 503 DOC_MIRROR_RETRY_UNAVAILABLE', 'public-cli', retryErr?.code === 'DOC_MIRROR_RETRY_UNAVAILABLE', retry.stdout);
evidence.retryMirrorError = retry.stdout;
limitations.push('doc manifest mirrorDelivery.retryAvailable=false confirmed queue unconfigured; no config was changed');

const docReadAfter = cli('doc', 'doc.read', { instance: docId });
const after = docReadAfter.stdout?.data?.result;
assert('doc content+revision unchanged after retryMirror', 'readback', after?.content === before?.content && after?.revision === before?.revision, { beforeRev: before?.revision, afterRev: after?.revision });

// ============ 4. archive both (logical, restorable) ============
const skArch = cli('sketch', 'sketch.archive', { instance: sketchId, key: `${RUN}-sk-arch` });
assert('sketch.archive sets archivedAt', 'public-cli', skArch.exit === 0 && typeof skArch.stdout?.data?.result?.meta?.archivedAt === 'string', skArch.stdout?.data);
const skReadAfterArch = cli('sketch', 'sketch.read', { instance: sketchId });
assert('archived sketch still readable', 'readback', skReadAfterArch.exit === 0 && skReadAfterArch.stdout?.data?.result?.meta?.archivedAt === skArch.stdout?.data?.result?.meta?.archivedAt, skReadAfterArch.stdout?.data?.result?.meta);

const docArch = cli('doc', 'doc.archive', { instance: docId, key: `${RUN}-doc-arch` });
assert('doc.archive sets archivedAt', 'public-cli', docArch.exit === 0 && typeof docArch.stdout?.data?.result?.meta?.archivedAt === 'string', docArch.stdout?.data);
const docReadAfterArch = cli('doc', 'doc.read', { instance: docId });
assert('archived doc still readable', 'readback', docReadAfterArch.exit === 0 && docReadAfterArch.stdout?.data?.result?.meta?.archivedAt === docArch.stdout?.data?.result?.meta?.archivedAt, docReadAfterArch.stdout?.data?.result?.meta);

const result = {
  run: RUN,
  scope: 'sketch.bind | sketch.export-image | doc.retryMirror via real canvas-workspace CLI subprocess; loopback 19465/19464 only',
  evidence, commands, assertions, limitations,
  summary: {
    total: assertions.length,
    passed: assertions.filter(a => a.ok).length,
    failed: assertions.filter(a => !a.ok).map(a => a.name),
  },
};
writeFileSync(path.join(WORK, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({mode:'isolated-local-test; not production MA or cloud acceptance',report:path.join(WORK,'result.json'),...result.summary}));
process.exitCode = result.summary.failed.length ? 1 : 0;
