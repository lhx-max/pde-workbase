/** Four frozen production-profile containers. Default dependencies are HTTPS
 * protocol fixtures. Explicit --owned-cloud instead uses newly owned private
 * test storage through a host-only maintenance gateway; MA remains a fixture.
 * Neither mode is formal MA, production identity or deployed acceptance. */
import { createServer, type Server } from 'node:https';
import { createHash, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute, dirname } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { execFile,spawn,type ChildProcess } from 'node:child_process';
import {createServer as createNetServer} from 'node:net';
import assert from 'node:assert/strict';
import { PrivateAppwriteFixture } from './lib/private-appwrite-fixture.js';
import { createProvisionPlan, provisionPrivateStorage } from '../tools/provision/src/private-storage.js';
import { writerLockDocumentId } from '../packages/app-cloud-state/src/index.js';
import {OwnedCloudAcceptance} from './lib/owned-cloud-acceptance.js';
import {probeAppLifecycles} from './lib/app-lifecycle-probe.js';
import {probeDocReceiptCapacity} from './lib/doc-receipt-capacity-probe.js';

const PROFILE = 'four-frozen-production-containers-private-schema-https-protocol-fixtures';
const { values } = parseArgs({ options: { manifest: { type: 'string' }, output: { type: 'string' }, 'owned-cloud':{type:'string'},'agent-handoff':{type:'string'},'review-handoff':{type:'string'},'resume-agent-handoff':{type:'string'},lifecycle:{type:'boolean',default:false},'simulate-unclean-stop':{type:'boolean',default:false},'doc-shutdown-diagnostics':{type:'boolean',default:false},'doc-receipt-capacity':{type:'boolean',default:false} } });
if (!values.manifest || !isAbsolute(values.manifest) || !values.output || !isAbsolute(values.output)) {
  throw Error('Absolute --manifest and --output paths are required');
}
if(values['simulate-unclean-stop']&&(values['owned-cloud']||values['agent-handoff']||values['review-handoff']||process.env.NODE_ENV==='production'))throw Error('Unclean-stop fault injection is only allowed in isolated protocol fixtures');
await mkdir(dirname(values.output), { recursive: true });
if(values['agent-handoff']&&values['review-handoff'])throw Error('Choose one explicit review handoff mode');
const handoffPath=values['agent-handoff']??values['review-handoff'];
const ownedCloud=values['owned-cloud']?await OwnedCloudAcceptance.load(values['owned-cloud']):undefined;
if(handoffPath&&(!ownedCloud||!isAbsolute(handoffPath)))throw Error('Agent handoff requires explicit owned-cloud mode and absolute path');
let resume:any;
if(values['resume-agent-handoff']){
  if(!handoffPath||!ownedCloud||!isAbsolute(values['resume-agent-handoff']))throw Error('Resume requires owned-cloud and a separate absolute output handoff');
  resume=JSON.parse(await readFile(values['resume-agent-handoff'],'utf8'));
  if(!['external-agent-cli-real-cloud-local-ma-fixture','root-ui-real-cloud-local-ma-fixture'].includes(resume.profile)||resume.realCloud!==true||resume.formalMa!==false||!/^fixture-team-[a-f0-9]{8}$/.test(resume.actor?.teamId??''))throw Error('Only an isolated acceptance handoff may resume');
  for(const app of ['canvas','doc','sketch','image'])if(!/^[A-Za-z0-9_-]{1,128}$/.test(resume.instances?.[app]??'')||resume.maApplicationInstances?.[app]!=='mai-'+app)throw Error('Invalid isolated resume identity');
}
let requestedStop=false;
if(handoffPath)for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{requestedStop=true;});
const run = promisify(execFile);
const docker = async (args: string[]) => (await run('docker', args, { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim();

const TEAM = resume?.actor.teamId??(ownedCloud?'fixture-team-'+randomUUID().slice(0,8):'fixture-team');
const TEST_CANVAS_ID=ownedCloud?'probe-canvas-'+randomUUID().slice(0,8):'probe-canvas-1';
if(ownedCloud)assert.match(process.version,/^v24\./,'Native Image acceptance requires Node24');
const BIZ = 'fixture-biz';
const APPS = ['canvas', 'doc', 'sketch', 'image'] as const;
type App = (typeof APPS)[number];
const INSTANCE: Record<App, string> = { canvas: 'mai-canvas', doc: 'mai-doc', sketch: 'mai-sketch', image: 'mai-image' };
const PROVIDER: Record<App, string> = { canvas: 'mp-canvas', doc: 'mp-doc', sketch: 'mp-sketch', image: 'mp-image' };
const PORT: Record<App, number> = { canvas: 17456, doc: 19000, sketch: 17610, image: 17466 };
const ALT_INSTANCE: Record<App, string> = {canvas:'mai-canvas-alt',doc:'mai-doc-alt',sketch:'mai-sketch-alt',image:'mai-image-alt'};
const tokenSuffix=ownedCloud?'-'+randomUUID():'';
const fixtureToken=(user:string)=>user+tokenSuffix;
const SSO = {
  writer: 'Bearer '+fixtureToken('fixture-writer'),
  reader: 'Bearer '+fixtureToken('fixture-reader'),
  foreign: 'Bearer '+fixtureToken('fixture-foreign'),
  revocable: 'Bearer '+fixtureToken('fixture-revocable'),
  agent:'Bearer '+fixtureToken('fixture-agent'),
};

const checks: string[] = [];
const failures: string[] = [];
const images: Record<string, { tag: string; imageId: string }> = {};
const logs: Record<string, string> = {};
const runtimeProof:Record<string,unknown>={};
const businessProof:Record<string,unknown>={};
let containersRemoved=0;
const containers: string[] = [];
const containerApps=new Map<string,App>();
const finalContainerStops:Array<Record<string,unknown>>=[];
let nativeImage:ChildProcess|undefined;
let nativeImageEnvironment:Record<string,string>|undefined;
let nativeStarts=0,nativeStops=0;
let failure: string | undefined;
const check = (name: string, fn: () => void | Promise<void>) => Promise.resolve(fn()).then(
  () => { checks.push(name); },
  error => { failures.push(`${name}: ${error instanceof Error ? error.message : error}`); },
);
const dir = await mkdtemp(join(tmpdir(), 'four-container-probe-'));
const fixture = new PrivateAppwriteFixture({ projectId: 'fixture-project', apiKey: 'fixture-probe-key', teamId: TEAM });
fixture.addUser(fixtureToken('fixture-writer'), 'fixture-writer', [...Object.values(INSTANCE),...Object.values(ALT_INSTANCE)]);
fixture.addUser(fixtureToken('fixture-reader'), 'fixture-reader', Object.values(INSTANCE));
fixture.addUser(fixtureToken('fixture-foreign'), 'fixture-foreign', ['mai-foreign']);
fixture.addUser(fixtureToken('fixture-revocable'), 'fixture-revocable', Object.values(INSTANCE));
if(handoffPath)fixture.addUser(fixtureToken('fixture-agent'),'fixture-agent',Object.values(INSTANCE));
for (const app of APPS) fixture.addInstance({ applicationInstanceId: INSTANCE[app], status: 'active', bizId: BIZ, applicationId: app, providerInstanceId: PROVIDER[app] });
for(const app of APPS)fixture.addInstance({applicationInstanceId:ALT_INSTANCE[app],status:'active',bizId:BIZ,applicationId:app,providerInstanceId:PROVIDER[app]+'-alternate'});
fixture.addInstance({ applicationInstanceId: 'mai-foreign', status: 'active', bizId: 'biz-foreign', applicationId: 'canvas', providerInstanceId: 'mp-foreign' });

/* ---- minimal real PNG encoder (no fixture asset is pre-supplied) ---- */
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (buf: Uint8Array) => { let c = ~0; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8); return ~c >>> 0; };
const pngChunk = (type: string, data: Uint8Array) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
};
function makePng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; for (let x = 0; x < width; x++) { const o = y * (width * 3 + 1) + 1 + x * 3; raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; } }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', new Uint8Array(0))]);
}
const pngSize = (bytes: Uint8Array) => ({ width: Buffer.from(bytes).readUInt32BE(16), height: Buffer.from(bytes).readUInt32BE(20) });
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/* ---- HTTPS dependency gateway ---- */
const proxies: Array<{ prefix: string; origin: () => string | undefined }> = [
  { prefix: '/api/apps/image', origin: () => origins.image },
  { prefix: '/api/apps/doc', origin: () => origins.doc },
  { prefix: '/api/apps/sketch', origin: () => origins.sketch },
  { prefix: '/api/apps/canvas', origin: () => origins.canvas },
  { prefix: '/api/projects', origin: () => origins.canvas },
];
const origins: Partial<Record<App, string>> = {};
const PROXY_HEADERS = ['content-type', 'accept', 'idempotency-key', 'if-match', 'x-mav-sso-authorization', 'x-mav-tenant', 'x-mav-application-instance-id', 'x-team-id', 'x-user-id'];

await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'ca.pem'), '-days', '1', '-subj', '/CN=fixture-gateway', '-addext', 'subjectAltName=DNS:host.docker.internal,DNS:localhost,IP:127.0.0.1']);
const gateway: Server = createServer({ key: await readFile(join(dir, 'key.pem')), cert: await readFile(join(dir, 'ca.pem')) }, async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 64 * 1024 * 1024) throw Error('fixture request too large'); chunks.push(Buffer.from(chunk)); }
    const rawBody = Buffer.concat(chunks);
    const url = new URL(req.url ?? '/', 'https://fixture.invalid');
    const pathname = url.pathname;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(key, value);
    if (pathname.startsWith('/api/ma-v/v1')) {
      const result = fixture.ma(pathname + url.search, headers);
      res.writeHead(result.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result.json ?? {}));
      return;
    }
    if (pathname.startsWith('/v1')) {
      if(ownedCloud){
        const response=await ownedCloud.gateway(req.method??'GET',(pathname+url.search).slice(3),headers,rawBody);
        const bytes=new Uint8Array(await response.arrayBuffer());
        res.writeHead(response.status,{'content-type':response.headers.get('content-type')??'application/json','content-length':bytes.byteLength});res.end(Buffer.from(bytes));return;
      }
      let body: unknown;
      if (headers.get('content-type')?.startsWith('multipart/form-data')) {
        const parsed = await new Request('https://fixture.invalid' + req.url, { method: req.method, headers, body: rawBody as unknown as BodyInit }).formData();
        const file = parsed.get('file');
        body = { fileId: parsed.get('fileId'), ...(file instanceof File ? { file: { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) } } : {}) };
      } else if (rawBody.length) {
        body = JSON.parse(rawBody.toString('utf8'));
      }
      fixture.setUploadContext(headers);
      const result = fixture.appwrite(req.method ?? 'GET', (pathname + url.search).slice(3), headers, body);
      if (result.bytes !== undefined) {
        res.writeHead(result.status, { 'content-type': result.mime ?? 'application/octet-stream', 'content-length': result.bytes.byteLength });
        res.end(Buffer.from(result.bytes));
        return;
      }
      res.writeHead(result.status, { 'content-type': 'application/json' });
      res.end(result.status === 204 ? undefined : JSON.stringify(result.json ?? {}));
      return;
    }
    const proxy = proxies.find(p => pathname === p.prefix || pathname.startsWith(p.prefix + '/') || pathname.startsWith(p.prefix + '?'));
    if (proxy && proxy.origin()) {
      const response = await fetch(proxy.origin()! + req.url, {
        method: req.method, redirect: 'error',
        headers: Object.fromEntries(PROXY_HEADERS.flatMap(name => headers.get(name) !== null ? [[name, headers.get(name)!]] : [])),
        ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: rawBody }),
      });
      const out = new Uint8Array(await response.arrayBuffer());
      const responseHeaders: Record<string, string> = {};
      for (const name of ['content-type', 'etag', 'content-length']) { const value = response.headers.get(name); if (value) responseHeaders[name] = value; }
      res.writeHead(response.status, responseHeaders);
      res.end(Buffer.from(out));
      return;
    }
    fixture.unexpected.push(`${req.method} ${pathname}`);
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'FIXTURE_ROUTE_UNKNOWN', message: 'dependency gateway has no fixture for this path' } }));
  } catch (error) {
    if(res.headersSent||res.destroyed){res.destroy();return;}
    const code=Number((error as { status?: unknown }).status??500);
    res.writeHead(Number.isInteger(code)&&code>=400&&code<=599?code:500);
    res.end(JSON.stringify({ error: { code: 'FIXTURE_GATEWAY_ERROR' } }));
  }
});
await new Promise<void>(resolve => gateway.listen(0, '0.0.0.0', resolve));
const gatewayOrigin = `https://host.docker.internal:${(gateway.address() as { port: number }).port}`;

/* ---- HTTP helper against the real published container ports ---- */
interface Reply { status: number; data: any; bytes: Uint8Array; mime: string | null; etag: string | null }
const req = async (app: App, route: string, options: { method?: string; body?: unknown; key?: string; sso?: string; instance?: string; tenant?: string } = {}): Promise<Reply> => {
  if(requestedStop)throw Error('Owned acceptance stop requested');
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.key) headers['idempotency-key'] = options.key;
  const sso = options.sso === undefined ? SSO.writer : options.sso;
  if (sso) headers['x-mav-sso-authorization'] = sso;
  headers['x-mav-tenant'] = options.tenant ?? TEAM;
  headers['x-mav-application-instance-id'] = options.instance ?? INSTANCE[app];
  const response = await fetch(`http://127.0.0.1:${published[app]}${route}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers, redirect: 'error', signal: AbortSignal.timeout(20_000),
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  let data: any;
  try { data = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { /* binary asset */ }
  return { status: response.status, data, bytes, mime: response.headers.get('content-type'), etag: response.headers.get('etag') };
};
const published: Record<App, number> = {} as never;

/* ---- boot one frozen image ---- */
const start = async (app: App, name: string): Promise<void> => {
  if(requestedStop)throw Error('Owned acceptance stop requested');
  if(ownedCloud&&app==='image'){
    if(!nativeImageEnvironment)throw Error('Native Image maintenance environment unavailable');
    const portServer=createNetServer();await new Promise<void>(resolve=>portServer.listen(0,'127.0.0.1',resolve));const port=(portServer.address() as {port:number}).port;await new Promise<void>((resolve,reject)=>portServer.close(e=>e?reject(e):resolve()));
    const environment={...nativeImageEnvironment,PATH:process.env.PATH??'',NODE_ENV:'test',NODE_EXTRA_CA_CERTS:join(dir,'ca.pem'),IMAGE_PORT:String(port),IMAGE_HOST:'127.0.0.1',MAV_API_ORIGIN:'https://127.0.0.1:'+(gateway.address() as {port:number}).port,IMAGE_APPWRITE_ENDPOINT:ownedCloud.nativeImageEndpoint()};
    delete (environment as Record<string,string>).IMAGE_APPWRITE_API_KEY;
    const child=spawn(process.execPath,ownedCloud.nativeImageArgs(),{env:environment,stdio:['ignore','pipe','pipe']});
    child.once('error',()=>{failure='Native installed Image process unavailable';});
    nativeImage=child;nativeStarts++;logs['native-image']='';for(const stream of [child.stdout,child.stderr])stream?.on('data',part=>{logs['native-image']=(logs['native-image']+part.toString()).slice(-200_000);});
    published.image=port;return;
  }
  const id=await docker(['run', '-d', '--platform', 'linux/amd64', '--name', name, '--read-only', '--cap-drop=ALL', '--security-opt', 'no-new-privileges',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=1g,uid=1000,gid=1000',
    '--env-file', join(dir, `${app}.env`),
    '--mount', `type=bind,src=${join(dir, 'ca.pem')},dst=/run/secrets/ca.pem,readonly`,
    '-p', `127.0.0.1::${PORT[app]}`, images[app]!.tag]);
  assert.match(id,/^[0-9a-f]{64}$/);containers.push(id);containerApps.set(id,app);
  published[app] = Number((await docker(['port', name, `${PORT[app]}/tcp`])).split(':').at(-1));
};
const stopNativeImage=async()=>{
  const child=nativeImage;if(!child)return;nativeImage=undefined;
  if(child.exitCode===null&&child.signalCode===null){
    let timer:ReturnType<typeof setTimeout>|undefined;
    await new Promise<void>((resolve,reject)=>{child.once('exit',()=>{if(timer)clearTimeout(timer);resolve();});child.kill('SIGTERM');timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Native Image graceful stop timed out'));},30_000);});
  }
  nativeStops++;
};
const waitReady = async (app: App): Promise<void> => {
  const route = app === 'canvas' || app === 'doc' ? '/api/health' : '/api/ready';
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${published[app]}${route}`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch { /* still booting */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw Error(`${app} did not become ready`);
};

try {
  /* ===== manifest identity ===== */
  const manifest = JSON.parse(await readFile(values.manifest, 'utf8')) as { images: { app: string; tag: string; imageId: string; os: string; architecture: string }[] };
  for (const app of APPS) {
    const wanted = manifest.images.find(i => i.app === app);
    assert(wanted, `manifest lacks ${app} image`);
    const inspected = JSON.parse(await docker(['image', 'inspect', wanted.tag]))[0];
    assert.equal(inspected.Id, wanted.imageId, `${app} image id differs from manifest`);
    assert.equal(wanted.os, 'linux'); assert.equal(wanted.architecture, 'amd64');
    assert.equal(inspected.Config.User, 'node');assert.equal(inspected.Architecture,'amd64');assert.equal(inspected.Os,'linux');
    images[app] = { tag: wanted.tag, imageId: wanted.imageId };
    checks.push(`${app}: frozen image ${wanted.tag} identity ${wanted.imageId.slice(0, 19)}… matches manifest, linux/amd64 nonroot`);
  }

  /* ===== provision four fresh private databases/buckets ===== */
  const plans: Record<App, ReturnType<typeof createProvisionPlan>> = {} as never;
  for (const app of APPS) {
    const plan = ownedCloud?.plans[app]??createProvisionPlan(app, `${app}_probe_private`, `${app}_probe_assets`, app === 'sketch' ? undefined : `${app}-probe`);
    const result = await provisionPrivateStorage(ownedCloud?ownedCloud.provisionClient(app):fixture.provisionClient(), plan, { apply: !ownedCloud });
    assert.equal(result.ready, true);
    assert.equal(result.schemaReady, true);
    plans[app] = plan;
    checks.push(`${app}: full private schema ${ownedCloud?'read-only verified on real cloud':'provisioned'} into ${plan.databaseId}/${plan.bucketId}${plan.namespace ? ` (namespace ${plan.namespace})` : ''}`);
  }

  /* ===== runtime environment per app ===== */
  const appwrite = (db: string, bucket: string) => ({
    APPWRITE_ENDPOINT: `${gatewayOrigin}/v1`, APPWRITE_PROJECT: 'fixture-project',
    APPWRITE_DATABASE: db, APPWRITE_BUCKET: bucket, APPWRITE_API_KEY: 'fixture-probe-key',
    APPWRITE_RUNTIME_COLLECTION: 'app_runtime_state',
  });
  const agentActions:Record<App,string[]>={canvas:['canvas.operations'],doc:['doc.write'],sketch:['sketch.write'],image:['image.tool']};
  const grants = (app: App, actions: string[]) => JSON.stringify([{ teamId: TEAM, bizId: BIZ, userId: 'fixture-writer', applicationId: app, applicationInstanceId: INSTANCE[app], actions },...(handoffPath?[{teamId:TEAM,bizId:BIZ,userId:'fixture-agent',applicationId:app,applicationInstanceId:INSTANCE[app],actions:agentActions[app]}]:[])]);
  const envs: Record<App, Record<string, string>> = {
    canvas: {
      NODE_ENV: 'production', NODE_EXTRA_CA_CERTS: '/run/secrets/ca.pem',
      ...appwrite('canvas_probe_private', 'canvas_probe_assets'),
      CANVAS_RUNTIME_NAMESPACE: 'canvas-probe', CANVAS_APPWRITE_SINGLE_WRITER: 'true', CANVAS_REPLICAS: '1',
      CANVAS_DATA_DIR: '/tmp/canvas-working', CANVAS_PORT: '17456', CANVAS_WEB_URL: gatewayOrigin,
      MAV_API_ORIGIN: gatewayOrigin,
      CANVAS_IMAGE_APP_ORIGIN: gatewayOrigin, CANVAS_IMAGE_APPLICATION_ID: 'image',
      CANVAS_TRUSTED_APP_ORIGINS: gatewayOrigin,
      APP_WRITE_GRANTS_JSON: grants('canvas', ['canvas.create', 'canvas.write', 'canvas.operations', 'canvas.rename', 'canvas.delete',
        'image.create', 'image.import', 'image.configure', 'image.tool', 'image.generate', 'image.regenerate', 'image.edit.save', 'image.cancel', 'image.archive']),
    },
    doc: {
      NODE_ENV: 'production', NODE_EXTRA_CA_CERTS: '/run/secrets/ca.pem', DOC_STORAGE_MODE: 'appwrite',
      ...appwrite('doc_probe_private', 'doc_probe_assets'),
      DOC_RUNTIME_NAMESPACE: 'doc-probe', DOC_APPWRITE_SINGLE_WRITER: 'true', DOC_REPLICAS: '1',
      DOC_DATA_DIR: '/tmp/doc-working', DOC_MIRROR_QUEUE_DIR: '/tmp/doc-mirror', DOC_SERVER_PORT: '19000',
      DOC_PUBLIC_ENDPOINT: gatewayOrigin, DOC_PUBLIC_WEB: gatewayOrigin,
      CANVAS_ORIGIN: gatewayOrigin, MAV_API_ORIGIN: gatewayOrigin,
      APP_WRITE_GRANTS_JSON: grants('doc', ['doc.create', 'doc.write', 'doc.rename', 'doc.archive', 'doc.copy', 'doc.restore', 'doc.retryMirror', 'doc.open']),
    },
    sketch: {
      NODE_ENV: 'production', NODE_EXTRA_CA_CERTS: '/run/secrets/ca.pem',
      ...appwrite('sketch_probe_private', 'sketch_probe_assets'),
      SKETCH_APPWRITE_SINGLE_WRITER: 'true', SKETCH_REPLICAS: '1',
      SKETCH_DATA_DIR: '/tmp/sketch-working', SKETCH_SERVER_PORT: '17610', SKETCH_LISTEN_HOST: '0.0.0.0',
      SKETCH_PUBLIC_ENDPOINT: gatewayOrigin, SKETCH_PUBLIC_WEB: gatewayOrigin,
      CANVAS_ORIGIN: gatewayOrigin, MAV_API_ORIGIN: gatewayOrigin,
      APP_WRITE_GRANTS_JSON: grants('sketch', ['sketch.create', 'sketch.write', 'sketch.rename', 'sketch.archive', 'sketch.copy', 'sketch.restore', 'sketch.bind', 'sketch.export-image']),
    },
    image: {
      NODE_ENV: 'production', NODE_EXTRA_CA_CERTS: '/run/secrets/ca.pem',
      IMAGE_APPWRITE_ENDPOINT: `${gatewayOrigin}/v1`, IMAGE_APPWRITE_PROJECT_ID: 'fixture-project',
      IMAGE_APPWRITE_DATABASE_ID: 'image_probe_private', IMAGE_APPWRITE_RUNTIME_COLLECTION_ID: 'app_runtime_state',
      IMAGE_APPWRITE_BUCKET_ID: 'image_probe_assets', IMAGE_RUNTIME_NAMESPACE: 'image-probe',
      IMAGE_APPWRITE_API_KEY: 'fixture-probe-key', IMAGE_APPWRITE_SINGLE_WRITER: 'true', IMAGE_REPLICAS: '1',
      MAV_API_ORIGIN: gatewayOrigin, IMAGE_MA_APPLICATION_ID: 'image',
      IMAGE_MODELS: 'disabled', IMAGE_HOST: '0.0.0.0', IMAGE_PORT: '17466',
      IMAGE_WRITE_GRANTS: grants('image', ['image.create', 'image.import', 'image.configure', 'image.tool', 'image.generate', 'image.regenerate', 'image.edit.save', 'image.cancel', 'image.archive']),
    },
  };
  if(values['doc-shutdown-diagnostics'])envs.doc.DOC_SHUTDOWN_DIAGNOSTICS='1';
  nativeImageEnvironment=envs.image;
  for (const app of APPS) {
    if(ownedCloud){
      const plan=plans[app];
      const env=envs[app];
      if(app==='image')Object.assign(env,{IMAGE_APPWRITE_PROJECT_ID:ownedCloud.projectId,IMAGE_APPWRITE_DATABASE_ID:plan.databaseId,IMAGE_APPWRITE_BUCKET_ID:plan.bucketId,IMAGE_RUNTIME_NAMESPACE:plan.namespace!,IMAGE_APPWRITE_API_KEY:ownedCloud.channelKey});
      else Object.assign(env,{APPWRITE_PROJECT:ownedCloud.projectId,APPWRITE_DATABASE:plan.databaseId,APPWRITE_BUCKET:plan.bucketId,APPWRITE_API_KEY:ownedCloud.channelKey,...(app==='canvas'?{CANVAS_RUNTIME_NAMESPACE:plan.namespace!}:app==='doc'?{DOC_RUNTIME_NAMESPACE:plan.namespace!}:{})});
    }
    await writeFile(join(dir, `${app}.env`), Object.entries(envs[app]).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  }

  /* ===== boot four frozen containers ===== */
  const names: Record<App, string> = {} as never;
  for (const app of APPS) {
    names[app] = `fourprobe-${app}-${Date.now()}-${randomUUID().slice(0,8)}`;
    await start(app, names[app]);
    await waitReady(app);
    if(ownedCloud&&app==='image')runtimeProof[app]={arch:process.arch,platform:process.platform,uid:process.getuid?.(),node:process.version,mode:'test',readOnly:false,execution:'installed Image package, explicit loopback maintenance mode',entrySha256:ownedCloud.nativeImageEntrySha256};
    else {const actual=JSON.parse(await docker(['exec',names[app],'node','-e',"console.log(JSON.stringify({arch:process.arch,platform:process.platform,uid:process.getuid(),node:process.version,mode:process.env.NODE_ENV}))"]));assert.equal(actual.arch,'x64');assert.equal(actual.platform,'linux');assert.equal(actual.uid,1000);assert.equal(actual.mode,'production');assert.match(actual.node,/^v24\./);const meta=JSON.parse(await docker(['inspect',names[app]]))[0];assert.equal(meta.HostConfig.ReadonlyRootfs,true);runtimeProof[app]={...actual,readOnly:true};}
    checks.push(`${app}: ${ownedCloud&&app==='image'?'explicit native maintenance':'production container'} boot on private schema over HTTPS ${ownedCloud?'real test storage':'fixture'} (port ${published[app]})`);
  }
  for (const app of APPS) origins[app] = `http://127.0.0.1:${published[app]}`;

  if(!resume){
  /* ===== positives ===== */
  // Canvas: create -> write -> read -> replay
  let canvasId = '';
  let canvasRevision = 0;
  let nodeId = 'probe-node-1';
  await check('canvas create/write/read/replay', async () => {
    const created = await req('canvas', '/api/apps/canvas/actions/canvas.create', { body: { input: { name: 'Probe canvas', instanceId: TEST_CANVAS_ID } }, key: 'probe-canvas-create-1' });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    canvasId = created.data.data.result.instanceId;
    const replayed = await req('canvas', '/api/apps/canvas/actions/canvas.create', { body: { input: { name: 'Probe canvas', instanceId: TEST_CANVAS_ID } }, key: 'probe-canvas-create-1' });
    assert.equal(replayed.status, 201); assert.equal(replayed.data.data.replayed, true);
    assert.equal(replayed.data.data.receiptId, created.data.data.receiptId);
    const state0 = await req('canvas', `/api/apps/canvas/instances/${canvasId}/state`);
    assert.equal(state0.status, 200); canvasRevision = state0.data.data.revision;
    const op = await req('canvas', `/api/apps/canvas/instances/${canvasId}/operations`, {
      body: { operationId: 'probe-op-1', baseRevision: canvasRevision, operations: [{ type: 'node.create', node: { id: nodeId, kind: 'text', x: 40, y: 60, title: 'probe card', text: 'hello canvas' } }] },
    });
    assert.equal(op.status, 200, JSON.stringify(op.data));
    assert.equal(op.data.data.receipt.status, 'applied');
    canvasRevision = op.data.data.revision;
    const replay = await req('canvas', `/api/apps/canvas/instances/${canvasId}/operations`, {
      body: { operationId: 'probe-op-1', baseRevision: 0, operations: [{ type: 'node.create', node: { id: nodeId, kind: 'text', x: 40, y: 60, title: 'probe card', text: 'hello canvas' } }] },
    });
    assert.equal(replay.status, 200); assert.equal(replay.data.data.replayed, true);
    const receipt = await req('canvas', `/api/apps/canvas/instances/${canvasId}/operations/probe-op-1`);
    assert.equal(receipt.status, 200); assert.equal(receipt.data.data.receipt.status, 'applied');
    const state = await req('canvas', `/api/apps/canvas/instances/${canvasId}/state`);
    const node = state.data.data.state.workbenchBasicNodes.find((n: { id: string }) => n.id === nodeId);
    assert(node, 'created node missing from canvas state');
    assert.equal(node.text, 'hello canvas');
    // Canvas-owned file channel writes to canvas_files + private bucket.
    const file = await req('canvas', `/api/apps/canvas/instances/${canvasId}/files?path=${encodeURIComponent('docs/probe.md')}`, { method: 'PUT', body: { content: 'canvas-owned file body' } });
    assert.equal(file.status, 200, JSON.stringify(file.data));
    const fileBack = await req('canvas', `/api/apps/canvas/instances/${canvasId}/files?path=${encodeURIComponent('docs/probe.md')}`);
    assert.equal(fileBack.data.data.content, 'canvas-owned file body');
  });

  // Doc: create -> versioned write -> read -> receipt
  let docId = '';
  let docRevision = '';
  let docWriteBody:unknown;let docWriteReceipt='';
  await check('doc create/versioned-write/read/receipt', async () => {
    const created = await req('doc', '/api/apps/doc/actions/doc.create', { body: { input: { name: 'Probe doc', content: 'initial body' } }, key: 'probe-doc-create-1' });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    docId = created.data.data.result.instanceId;
    const replay = await req('doc', '/api/apps/doc/actions/doc.create', { body: { input: { name: 'Probe doc', content: 'initial body' } }, key: 'probe-doc-create-1' });
    assert.equal(replay.data.data.replayed, true);
    assert.equal(replay.data.data.receiptId, created.data.data.receiptId);
    const state0 = await req('doc', `/api/apps/doc/instances/${docId}/state`);
    assert.equal(state0.status, 200); docRevision = state0.data.data.revision;
    assert.equal(state0.data.data.content, 'initial body');
    docWriteBody={input:{content:'updated body v2',expectedRevision:docRevision}};
    const written = await req('doc', `/api/apps/doc/instances/${docId}/actions/doc.write`, { body: docWriteBody, key: 'probe-doc-write-1' });
    assert.equal(written.status, 200, JSON.stringify(written.data));
    docWriteReceipt=written.data.data.receiptId;docRevision = written.data.data.result.revision;
    const receipt = await req('doc', `/api/apps/doc/instances/${docId}/action-receipts/probe-doc-write-1`);
    assert.equal(receipt.status, 200); assert.equal(receipt.data.data.receipt.status, 'succeeded');
    const state = await req('doc', `/api/apps/doc/instances/${docId}/state`);
    assert.equal(state.data.data.content, 'updated body v2');
  });

  // Sketch: create -> versioned scene save -> read
  let sketchId = '';let sketchRevision='';let sketchWriteBody:unknown;let sketchWriteReceipt='';
  await check('sketch create/versioned-save/read', async () => {
    const scene = JSON.stringify({ schemaVersion: 1, elements: [{ id: 'p1' }] });
    const created = await req('sketch', '/api/apps/sketch/actions/sketch.create', { body: { input: { name: 'Probe sketch', content: scene } }, key: 'probe-sketch-create-1' });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    sketchId = created.data.data.result.instanceId;
    const replay = await req('sketch', '/api/apps/sketch/actions/sketch.create', { body: { input: { name: 'Probe sketch', content: scene } }, key: 'probe-sketch-create-1' });
    assert.equal(replay.data.data.replayed, true);
    const meta = created.data.data.result.meta;
    const scene2 = JSON.stringify({ schemaVersion: 1, elements: [{ id: 'p1' }, { id: 'p2' }] });
    sketchWriteBody={input:{content:scene2,expectedRevision:meta.revision}};
    const written = await req('sketch', `/api/apps/sketch/instances/${sketchId}/actions/sketch.write`, { body: sketchWriteBody, key: 'probe-sketch-write-1' });
    assert.equal(written.status, 200, JSON.stringify(written.data));
    const state = await req('sketch', `/api/apps/sketch/instances/${sketchId}/state`);
    assert.equal(state.data.data.content, scene2);sketchRevision=state.data.data.revision;sketchWriteReceipt=written.data.data.receiptId;
    const receipt = await req('sketch', `/api/apps/sketch/instances/${sketchId}/action-receipts/probe-sketch-write-1`);
    assert.equal(receipt.status, 200); assert.equal(receipt.data.data.receipt.status, 'succeeded');
  });

  // Image: create -> import original -> free CPU transform -> done job -> raw download
  let workspaceId = '', assetId = '', jobId = '', outputAssetId = '';let imageToolBody:unknown;
  const source = makePng(16, 32, [35, 111, 168]);
  let resultHash = '';
  await check('image create/import/CPU-transform/done-job/download', async () => {
    const created = await req('image', '/api/apps/image/actions/image.create', { body: { input: { name: 'Probe workspace' } }, key: 'probe-image-create-1' });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    workspaceId = created.data.data.result.id;
    const imported = await req('image', `/api/apps/image/instances/${workspaceId}/assets`, {
      body: { input: { path: 'originals/probe.png', role: 'original', mime: 'image/png', contentBase64: source.toString('base64') }, expectedRevision: 1 },
      key: 'probe-image-import-1',
    });
    assert.equal(imported.status, 200, JSON.stringify(imported.data));
    assetId = imported.data.data.result.id;
    assert.equal(imported.data.data.result.sha256, sha256(source));
    imageToolBody={input:{sourceAssetId:assetId,tool:{kind:'transform',source:'originals/probe.png',params:{rotation:90}}},expectedRevision:2};
    const accepted = await req('image', `/api/apps/image/instances/${workspaceId}/actions/image.tool`, {body:imageToolBody,key:'probe-image-tool-1'});
    assert.equal(accepted.status, 202, JSON.stringify(accepted.data));
    jobId = accepted.data.data.result.id;
    let job: any;
    for (let attempt = 0; attempt < 120; attempt++) {
      job = (await req('image', `/api/apps/image/instances/${workspaceId}/jobs/${jobId}`)).data.data;
      if (!['queued', 'running'].includes(job.status)) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(job.status, 'done', JSON.stringify(job));
    outputAssetId = job.outputAssetIds[0];
    const out = await req('image', `/api/apps/image/instances/${workspaceId}/assets/${outputAssetId}`);
    assert.equal(out.status, 200); assert.equal(out.mime, 'image/png');
    resultHash = sha256(out.bytes);
    assert.equal(out.etag, `"${resultHash}"`);
    const size = pngSize(out.bytes);
    assert.deepEqual([size.width, size.height], [32, 16], 'CPU rotation produced wrong dimensions');businessProof.image={workspaceId,assetId,jobId,outputAssetId,sha256:resultHash,...size};
  });

  // Canvas references the Image result; preview must equal Image bytes.
  let referenceNodeId = '';
  await check('canvas image reference + authenticated preview', async () => {
    canvasRevision = (await req('canvas', `/api/apps/canvas/instances/${canvasId}/state`)).data.data.revision;
    const attached = await req('canvas', `/api/projects/${canvasId}/image-app/references`, {
      body: { applicationInstanceId: INSTANCE.image, workspaceId, assetId: outputAssetId, x: 5, y: 5, expectedRevision: canvasRevision },
      key: 'probe-image-ref-1',
    });
    assert.equal(attached.status, 201, JSON.stringify(attached.data));
    referenceNodeId = attached.data.data.nodeId;
    const state = await req('canvas', `/api/apps/canvas/instances/${canvasId}/state`);
    const node = state.data.data.state.workbenchImages.find((n: { id: string }) => n.id === referenceNodeId);
    assert(node?.imageReference, 'reference-only card missing');
    assert.equal(node.imageReference.assetId, outputAssetId);
    assert.equal(node.imageReference.applicationInstanceId, INSTANCE.image);
    assert.equal(node.imageReference.sha256, resultHash);assert(!['config','jobs','editState','bytes','mediaRequest'].some(k=>k in node),'Canvas must retain reference-only business fields');businessProof.canvas={canvasId,referenceNodeId,imageReference:node.imageReference};
    canvasRevision = state.data.data.revision;
    const preview = await req('canvas', `/api/projects/${canvasId}/image-app/references/${referenceNodeId}/preview`);
    assert.equal(preview.status, 200);
    assert.equal(sha256(preview.bytes), resultHash, 'preview bytes differ from the Image asset bytes');
  });

  /* ===== negatives ===== */
  await check('missing authority credential denied on all four apps', async () => {
    for (const [app, route] of [['canvas', `/api/apps/canvas/instances/${canvasId}/state`], ['doc', `/api/apps/doc/instances/${docId}/state`], ['sketch', `/api/apps/sketch/instances/${sketchId}/state`], ['image', `/api/apps/image/instances/${workspaceId}/state`]] as const) {
      const missing = await req(app as App, route, { sso: '' });
      assert([401, 403].includes(missing.status), `${app} accepted a request without SSO (${missing.status})`);
    }
  });
  await check('foreign biz and foreign instance denied; canonical state unchanged', async () => {
    const foreignInstance = await req('canvas', `/api/apps/canvas/instances/${canvasId}/state`, { sso: SSO.foreign, instance: 'mai-foreign' });
    assert.equal(foreignInstance.status, 403);
    const foreignBody = await req('canvas', `/api/apps/canvas/instances/${canvasId}/state`, { sso: SSO.foreign, instance: INSTANCE.canvas });
    assert.equal(foreignBody.status, 403); // foreign user is not a member of mai-canvas
    const foreignDoc = await req('doc', `/api/apps/doc/instances/${docId}/state`, { sso: SSO.foreign, instance: 'mai-foreign' });
    assert.equal(foreignDoc.status, 403);
    const state = await req('canvas', `/api/apps/canvas/instances/${canvasId}/state`);
    assert.equal(state.data.data.revision, canvasRevision, 'denial mutated canvas state');
  });
  await check('same user and business cannot read another authorized application instance',async()=>{
    const routes:Record<App,string>={canvas:`/api/apps/canvas/instances/${canvasId}/state`,doc:`/api/apps/doc/instances/${docId}/state`,sketch:`/api/apps/sketch/instances/${sketchId}/state`,image:`/api/apps/image/instances/${workspaceId}/state`};
    for(const app of APPS){const denied=await req(app,routes[app],{instance:ALT_INSTANCE[app]});assert.equal(denied.status,app==='image'?404:403,app+' returned an unexpected cross-instance response');if(app==='image')assert.equal(denied.data.error.code,'IMAGE_WORKSPACE_NOT_FOUND');}
  });
  await check('verified reader denied writes on all four apps', async () => {
    const c = await req('canvas', `/api/apps/canvas/instances/${canvasId}/operations`, { sso: SSO.reader, body: { operationId: 'probe-op-denied', baseRevision: canvasRevision, operations: [{ type: 'node.delete', nodeId }] } });
    assert.equal(c.status, 403, JSON.stringify(c.data));
    const d = await req('doc', `/api/apps/doc/instances/${docId}/actions/doc.write`, { sso: SSO.reader, body: { input: { content: 'reader write', expectedRevision: docRevision } }, key: 'probe-reader-write' });
    assert.equal(d.status, 403);
    const s = await req('sketch', `/api/apps/sketch/instances/${sketchId}/actions/sketch.write`, { sso: SSO.reader, body: { input: { content: '{}',expectedRevision:sketchRevision } }, key: 'probe-reader-write' });
    assert.equal(s.status, 403);
    const i = await req('image', '/api/apps/image/actions/image.create', { sso: SSO.reader, body: { input: { name: 'reader' } }, key: 'probe-reader-create' });
    assert.equal(i.status, 403);
    const state = await req('canvas', `/api/apps/canvas/instances/${canvasId}/state`);
    assert.equal(state.data.data.revision, canvasRevision);
    assert(state.data.data.state.workbenchBasicNodes.some((n: { id: string }) => n.id === nodeId), 'denied write deleted the node');
    assert.equal((await req('doc', `/api/apps/doc/instances/${docId}/state`)).data.data.content, 'updated body v2');
  });
  await check('stale versions rejected without mutation', async () => {
    const stale = await req('canvas', `/api/apps/canvas/instances/${canvasId}/operations`, { body: { operationId: 'probe-op-2', baseRevision: 0, operations: [{ type: 'node.rename', nodeId, title: 'stale' }] } });
    assert.equal(stale.status, 409);
    const staleImage = await req('image', `/api/apps/image/instances/${workspaceId}/actions/image.configure`, { body: { input: { assetId, set: {} }, expectedRevision: 99 }, key: 'probe-stale-image' });
    assert.equal(staleImage.status, 409);
    const staleDoc=await req('doc',`/api/apps/doc/instances/${docId}/actions/doc.write`,{body:{input:{content:'stale write',expectedRevision:(docWriteBody as any).input.expectedRevision}},key:'probe-stale-doc'});assert.equal(staleDoc.status,409);
    const staleSketch=await req('sketch',`/api/apps/sketch/instances/${sketchId}/actions/sketch.write`,{body:{input:{content:'{\"elements\":[]}',expectedRevision:(sketchWriteBody as any).input.expectedRevision}},key:'probe-stale-sketch'});assert.equal(staleSketch.status,409);
    assert.equal((await req('canvas', `/api/apps/canvas/instances/${canvasId}/state`)).data.data.revision, canvasRevision);
  });
  await check('disabled generation returns unavailable with no job mutation', async () => {
    const before = (await req('image', `/api/apps/image/instances/${workspaceId}/state`)).data.data;
    const denied = await req('image', `/api/apps/image/instances/${workspaceId}/actions/image.generate`, { body: { input: { config: { prompt: 'fixture should never reach a supplier' } }, expectedRevision: before.workspace.revision }, key: 'probe-generate-1' });
    assert.equal(denied.status,503,JSON.stringify(denied.data));assert.equal(denied.data.error.code,'IMAGE_MODEL_UNAVAILABLE');
    const after = (await req('image', `/api/apps/image/instances/${workspaceId}/state`)).data.data;
    assert.equal(after.workspace.revision, before.workspace.revision, 'disabled generation mutated the workspace');
    assert.equal(after.jobs.length, before.jobs.length, 'disabled generation created a job');
  });
  await check('fixture revocation makes all four apps re-deny a previously valid actor',async()=>{
    const routes:Record<App,string>={canvas:`/api/apps/canvas/instances/${canvasId}/state`,doc:`/api/apps/doc/instances/${docId}/state`,sketch:`/api/apps/sketch/instances/${sketchId}/state`,image:`/api/apps/image/instances/${workspaceId}/state`};for(const app of APPS)assert.equal((await req(app,routes[app],{sso:SSO.revocable})).status,200,app+' actor was not valid before revocation');fixture.revoke(fixtureToken('fixture-revocable'));for(const app of APPS){const denied=await req(app,routes[app],{sso:SSO.revocable});assert([401,403].includes(denied.status),app+' used revoked authority');}
  });

  const lifecycle=values.lifecycle?await probeAppLifecycles({request:req,teamId:TEAM,png:makePng(32,24,[200,30,30])}):undefined;

  const capacity=values['doc-receipt-capacity']?await probeDocReceiptCapacity(req):undefined;
  if(capacity){checks.push('doc: individual and aggregate durable receipts exceed 1 MiB without reducing body limits');businessProof.docReceiptCapacity=capacity.evidence;}

  /* ===== graceful stop -> writer locks released -> restart recovers ===== */
  const lockCheck: Record<App, string> = { canvas: 'canvas_probe_private', doc: 'doc_probe_private', sketch: 'sketch_probe_private', image: 'image_probe_private' };
  for (const app of APPS)if(ownedCloud&&app==='image')await stopNativeImage();else await docker(['stop', '--time', '30', names[app]]);
  await check('writer locks released on graceful stop', async () => {
    for (const app of APPS) {
      const lockId = writerLockDocumentId(app);
      if(ownedCloud)assert.equal(await ownedCloud.lockAbsent(app),true,`${app} actual cloud writer lock still held`);
      else assert.equal(fixture.document(lockCheck[app], 'app_runtime_state', lockId), undefined, `${app} writer lock still held`);
    }
  });
  for (const app of APPS) {
    if(ownedCloud&&app==='image')await start(app,names[app]);else{await docker(['start', names[app]]);published[app] = Number((await docker(['port', names[app], `${PORT[app]}/tcp`])).split(':').at(-1));}
    origins[app] = `http://127.0.0.1:${published[app]}`;
    await waitReady(app);
  }
  checks.push(`${ownedCloud?'three containers plus native Image':'all four containers'} restarted on the same ${ownedCloud?'real private cloud':'fixture'} state`);
  await check('post-restart business state, receipts, files and jobs recover', async () => {
    const state = await req('canvas', `/api/apps/canvas/instances/${canvasId}/state`);
    assert.equal(state.status, 200); assert.equal(state.data.data.revision, canvasRevision);
    assert(state.data.data.state.workbenchBasicNodes.some((n: { id: string }) => n.id === nodeId));
    const replay = await req('canvas', '/api/apps/canvas/actions/canvas.create', { body: { input: { name: 'Probe canvas', instanceId: TEST_CANVAS_ID } }, key: 'probe-canvas-create-1' });
    assert.equal(replay.data.data.replayed, true, 'create receipt did not survive restart');
    const docState = await req('doc', `/api/apps/doc/instances/${docId}/state`);
    assert.equal(docState.data.data.content, 'updated body v2');
    const sketchState = await req('sketch', `/api/apps/sketch/instances/${sketchId}/state`);
    assert(sketchState.data.data.content.includes('"p2"'));
    const dReplay=await req('doc',`/api/apps/doc/instances/${docId}/actions/doc.write`,{body:docWriteBody,key:'probe-doc-write-1'});assert.equal(dReplay.status,200);assert.equal(dReplay.data.data.replayed,true);assert.equal(dReplay.data.data.receiptId,docWriteReceipt);
    const sReplay=await req('sketch',`/api/apps/sketch/instances/${sketchId}/actions/sketch.write`,{body:sketchWriteBody,key:'probe-sketch-write-1'});assert.equal(sReplay.status,200);assert.equal(sReplay.data.data.replayed,true);assert.equal(sReplay.data.data.receiptId,sketchWriteReceipt);
    const iReplay=await req('image',`/api/apps/image/instances/${workspaceId}/actions/image.tool`,{body:imageToolBody,key:'probe-image-tool-1'});assert.equal(iReplay.status,202);assert.equal(iReplay.data.data.replayed,true);assert.equal(iReplay.data.data.result.id,jobId);
    businessProof.doc={docId,revision:docState.data.data.revision,receiptId:docWriteReceipt,postRestartExactReplay:true};businessProof.sketch={sketchId,revision:sketchState.data.data.revision,receiptId:sketchWriteReceipt,postRestartExactReplay:true};
    const job = await req('image', `/api/apps/image/instances/${workspaceId}/jobs/${jobId}`);
    assert.equal(job.data.data.status, 'done');
    const out = await req('image', `/api/apps/image/instances/${workspaceId}/assets/${outputAssetId}`);
    assert.equal(sha256(out.bytes), resultHash, 'recovered asset bytes differ');
    const preview = await req('canvas', `/api/projects/${canvasId}/image-app/references/${referenceNodeId}/preview`);
    assert.equal(sha256(preview.bytes), resultHash);
  });
  if(capacity)await check('doc: large receipts replay after restart with exact hashes and cross-instance denial',()=>capacity.postRestart());
  if(lifecycle){await lifecycle.postRestart();checks.push(...lifecycle.checks);failures.push(...lifecycle.failures);businessProof.lifecycle=lifecycle.evidence;}
  } // fresh business campaign; resume preserves all prior business state
  if(resume){
    for(const app of APPS)await check(app+': prior Agent instance recovered after full owned-service stop',async()=>{
      const state=await req(app,'/api/apps/'+app+'/instances/'+resume.instances[app]+'/state',{sso:SSO.agent});
      assert.equal(state.status,200);assert(state.data.data);
    });
    Object.assign(businessProof,resume.businessProof);
  }
  if(handoffPath&&!failure&&!failures.length){
    const handoff=handoffPath;
    await writeFile(handoff+'.credential',SSO.agent+'\n',{flag:'wx',mode:0o600});
    await writeFile(handoff,JSON.stringify({profile:values['review-handoff']?'root-ui-real-cloud-local-ma-fixture':'external-agent-cli-real-cloud-local-ma-fixture',realCloud:true,formalMa:false,models:false,credentialType:'single-run synthetic MA actor; not a console session or real user SSO',credentialFile:handoff+'.credential',actor:{teamId:TEAM,userId:'fixture-agent'},maApplicationInstances:INSTANCE,instances:resume?.instances??{canvas:(businessProof.canvas as any).canvasId,doc:(businessProof.doc as any).docId,sketch:(businessProof.sketch as any).sketchId,image:(businessProof.image as any).workspaceId},endpoints:Object.fromEntries(APPS.map(app=>[app,`http://127.0.0.1:${published[app]}`])),allowedWrites:agentActions,imageOriginalAssetId:resume?.imageOriginalAssetId??(businessProof.image as any).assetId,canvasReferenceNodeId:resume?.canvasReferenceNodeId??(businessProof.canvas as any).referenceNodeId,sourceImage:{width:16,height:32},businessProof,rootCompletionFile:handoff+'.complete'},null,2),{flag:'wx',mode:0o600});
    console.log(JSON.stringify({stage:values['review-handoff']?'root-ui-handoff-ready':'agent-handoff-ready',descriptor:handoff}));
    const deadline=Date.now()+15*60_000;
    while(!requestedStop){
      const marker=await readFile(handoff+'.complete','utf8').catch(()=>undefined);
      if(marker!==undefined){let review:any;try{review=JSON.parse(marker);}catch{}if(review?.rootReviewed!==true||review?.passed!==true)throw Error('Agent handoff root review did not pass');break;}
      if(Date.now()>deadline)throw Error('Explicit review handoff timed out; owned services will stop');
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    if(requestedStop)throw Error('Explicit review handoff interrupted; owned services will stop');
    checks.push(values['review-handoff']?'Root UI handoff completed with explicit independent review; separate UI evidence required':'external Agent CLI handoff completed with explicit Root review; separate evidence required');
  }
  if(values['simulate-unclean-stop']){
    const owned=containers.find(id=>containerApps.get(id)==='doc');assert(owned,'Only an owned fixture Doc may be faulted');
    await docker(['kill','--signal','KILL',owned]);
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}

/* ===== cleanup: only the containers this probe created ===== */
await stopNativeImage().catch(()=>{failures.push('Owned native Image cleanup not confirmed');});
for (const name of containers) {
  try {
    const before=JSON.parse(await docker(['inspect',name]))[0];
    if(before.State.Running)await docker(['stop','--time','30',name]);
    const after=JSON.parse(await docker(['inspect',name]))[0];assert.equal(after.State.Running,false,'Owned container did not stop');
    const graceful=!after.State.OOMKilled&&[0,143].includes(after.State.ExitCode);
    finalContainerStops.push({app:containerApps.get(name),containerId:name,wasRunning:before.State.Running,exitCode:after.State.ExitCode,oomKilled:after.State.OOMKilled,graceful});
    if(!graceful)failures.push('Owned '+containerApps.get(name)+' container stop was not graceful; exit '+after.State.ExitCode);
    logs[name] = (await run('docker', ['logs', name], {timeout:120_000,maxBuffer: 4 * 1024 * 1024 }).then(r => r.stdout + r.stderr, e => String(e.stdout ?? '') + String(e.stderr ?? ''))).slice(-200_000);
    await docker(['rm',name]);const remains=await docker(['ps','-a','--filter','id='+name,'--format','{{.ID}}']);assert.equal(remains,'');containersRemoved++;
  } catch(error) { failures.push('Owned probe container cleanup not confirmed: '+name); }
}
await check('final owned-service cleanup verifies writer locks absent; no forced lock takeover',async()=>{
  const databases:Record<App,string>={canvas:'canvas_probe_private',doc:'doc_probe_private',sketch:'sketch_probe_private',image:'image_probe_private'};
  for(const app of APPS){if(ownedCloud)assert.equal(await ownedCloud.lockAbsent(app),true,app+' actual cloud writer lock remains after cleanup');else assert.equal(fixture.document(databases[app],'app_runtime_state',writerLockDocumentId(app)),undefined,app+' writer lock remains after cleanup');}
});
await new Promise<void>(resolve => { gateway.close(() => resolve()); gateway.closeAllConnections(); });
const sanitize=(value:string)=>ownedCloud?Object.values(SSO).reduce((text,token)=>text.split(token.replace(/^Bearer /,'')).join('[fixture-credential]'),ownedCloud.redact(value)):value;
for (const [name, log] of Object.entries(logs)) await writeFile(join(dirname(values.output), `${name}.log`),sanitize(log));
await rm(dir, { recursive: true, force: true });
const unexpected = fixture.unexpected.filter((v, i, a) => a.indexOf(v) === i);
if (unexpected.length && !failure) failures.push(`unexpected external requests: ${unexpected.join('; ')}`);
const report = {
  passed: !failure && failures.length === 0,
  profile: ownedCloud?'three-frozen-containers-and-installed-image-package-real-private-cloud-local-ma-maintenance':PROFILE,
  images,runtimeProof,businessProof,
  checks, authorityReads: fixture.authorityReads, appwriteRequests: ownedCloud?.requests??fixture.appwriteRequests,
  ...(ownedCloud?{appwriteRequestCountScope:'requests observed by scoped host adapter; native Image direct requests excluded',nativeImageRequestsCounted:false}:{}),
  supplierDispatches: 0, unexpectedRequests: unexpected,
  realCloud: Boolean(ownedCloud), formalMa: false,
  ...(values['simulate-unclean-stop']?{faultInjection:'SIGKILL owned fixture Doc before final cleanup; expected overall failure'}:{}),
  ...(ownedCloud?{authority:'explicit local MA protocol fixture',storageIdentity:'host-side nonproduction maintenance session; no console credential in containers',storageRequests:ownedCloud.events,resources:Object.fromEntries(APPS.map(app=>[app,{databaseId:ownedCloud.plans[app].databaseId,bucketId:ownedCloud.plans[app].bucketId,namespace:ownedCloud.plans[app].namespace}]))}:{}),
  failures:failures.map(sanitize), failure: failure?sanitize(failure):null,
  cleanup: { finalContainerStops,containersCreated:containers.length,containersRemoved,nativeProcessesStarted:nativeStarts,nativeProcessesStopped:nativeStops, preserved: 'pre-existing containers, images and volumes untouched' },
};
await writeFile(values.output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: report.passed, checks: checks.length, failures: failures.length + (failure ? 1 : 0), authorityReads: fixture.authorityReads }));
if (failure) { console.error(failure); process.exitCode = 1; }
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
