import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';

const base = new URL(process.env.CANVAS_SERVER_URL ?? 'http://127.0.0.1:17456');
if (base.hostname !== '127.0.0.1' || base.protocol !== 'http:') throw new Error('demo 仅允许本地 127.0.0.1 HTTP 服务');
const headers = process.env.CANVAS_AUTH_TOKEN ? { authorization: `Bearer ${process.env.CANVAS_AUTH_TOKEN}` } : {};
async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(new URL(path, base), { ...init, headers: { ...headers, ...init.headers }, redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(`本地 demo 请求失败：${path} HTTP ${response.status} ${typeof error?.error?.code === 'string' ? error.error.code : ''}`);
  }
  return response;
}
async function json(path: string, body?: unknown) {
  return (await request(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() }, body: JSON.stringify(body) })).json();
}
const health = await json('/api/health');
if (health.storage?.canvas !== 'explicit-local-runtime') throw new Error('必须使用显式 local-test 服务，不能导入云端');
const scriptBytes = await readFile(new URL('./materials/jieshuo.txt', import.meta.url));
const videoBytes = await readFile(new URL('./materials/念念有回响_7582803412262063398.mp4', import.meta.url));
const script = scriptBytes.toString('utf8');
const videoDurationMs = 0;
const { data: created } = await json('/api/apps/canvas/actions/canvas.create', { input: { name: '念念有回响 · 本地素材 demo', instanceId: `drama-demo-${randomUUID()}` } });
const projectId = created.result?.instanceId;
if (typeof projectId !== 'string') throw new Error('创建画布未返回 instanceId');
const form = new FormData();
form.set('dir', 'inputs/drama');
form.append('files', new Blob([scriptBytes], { type: 'text/plain' }), 'jieshuo.txt');
form.append('files', new Blob([videoBytes], { type: 'video/mp4' }), 'episode.mp4');
const { files } = await (await request(`/api/projects/${projectId}/upload`, { method: 'POST', body: form })).json();
const videoPath = files.find((file: { originalName: string }) => file.originalName === 'episode.mp4')?.name;
const scriptPath = files.find((file: { originalName: string }) => file.originalName === 'jieshuo.txt')?.name;
if (!videoPath || !scriptPath) throw new Error('上传未返回完整素材引用');
for (const [path, bytes] of [[scriptPath, scriptBytes], [videoPath, videoBytes]] as const) {
  const saved = Buffer.from(await (await request(`/api/projects/${projectId}/raw/${path}`)).arrayBuffer());
  if (createHash('sha256').update(saved).digest('hex') !== createHash('sha256').update(bytes).digest('hex')) throw new Error('素材读回校验失败');
}
const { data: snapshot } = await json(`/api/apps/canvas/instances/${projectId}/state`);
await json(`/api/projects/${projectId}/canvas/operations`, {
  operationId: randomUUID(), baseRevision: snapshot.revision,
  operations: [
    { type: 'node.create', node: { id: 'drama-rewrite', kind: 'card.drama.audio', title: '① 视频与解说词 · 万擎改写', demoProfile: 'local-test', demoProjectId: projectId, x: 0, y: 0, width: 680, height: 1100, data: { stage: 'rewrite', downstreamNodeId: 'drama-audio', demoProfile: 'local-test', demoProjectId: projectId, script, videoRef: videoPath, videoDurationMs, rewriteLines: [], rewriteProvider: null } } },
    { type: 'node.create', node: { id: 'drama-audio', kind: 'card.drama.audio', title: '② 配音区间编辑与视频对齐', demoProfile: 'local-test', demoProjectId: projectId, x: 760, y: 0, width: 720, height: 1100, data: { stage: 'edit', rewriteLines: [], demoProfile: 'local-test', demoProjectId: projectId, dataVersion: 3, audioRef: null, durationMs: 0, segments: [], masterGain: 1, trimStartMs: null, trimEndMs: null, script, exportedPath: null, exportedDigest: null, videoRef: videoPath, videoDurationMs, captions: [], captionProvider: null, dubbingDoc: null, dubbingProvider: null } } },
  ],
});
const { data: result } = await json(`/api/apps/canvas/instances/${projectId}/state`);
if (!result.state.workbenchBasicNodes?.some((node: { id: string; data?: { script?: string } }) => node.id === 'drama-audio' && node.data?.script === script)) throw new Error('画布关联读回失败');
console.log(JSON.stringify({ projectId, scriptPath, videoPath, verified: true, profile: 'local-test', tts: '未生成' }));
