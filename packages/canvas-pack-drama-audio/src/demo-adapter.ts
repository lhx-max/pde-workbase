import { validateRewriteLines, rewriteDocOf } from './rewrite';
import { assertProjectRelativePath } from './schema';

export function demoProjectOf(node: Record<string, unknown>): string | null {
  const projectId = typeof node.demoProjectId === 'string' ? node.demoProjectId : node.data && typeof node.data === 'object' ? (node.data as Record<string, unknown>).demoProjectId : null;
  const profile = node.demoProfile ?? (node.data && typeof node.data === 'object' ? (node.data as Record<string, unknown>).demoProfile : null);
  if (profile !== 'local-test' || typeof projectId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(projectId)) return null;
  if (typeof location === 'undefined' || location.hostname !== '127.0.0.1') return null;
  return projectId;
}

export function demoMediaUrl(projectId: string, path: string): string {
  assertProjectRelativePath('mediaPath', path);
  return `/api/projects/${encodeURIComponent(projectId)}/raw/${path.split('/').map(encodeURIComponent).join('/')}`;
}

async function json(url: string, init?: RequestInit, signal?: AbortSignal) {
  const response = await fetch(url, { ...init, ...(signal ? { signal } : {}), redirect: 'error' });
  const body = await response.json();
  if (!response.ok || body.ok === false) throw new Error(body.error?.message ?? body.error?.code ?? `HTTP ${response.status}`);
  return body;
}

async function snapshot(projectId: string, signal?: AbortSignal) {
  const health = await json('/api/health', undefined, signal);
  if (health.storage?.canvas !== 'explicit-local-runtime') throw new Error('此调用仅支持本地 demo');
  return (await json(`/api/apps/canvas/instances/${projectId}/state`, undefined, signal)).data;
}

async function patchNodes(projectId: string, current: { revision: number }, nodes: unknown[], signal?: AbortSignal) {
  return json(`/api/projects/${projectId}/canvas/state`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedRevision: current.revision, changes: { workbenchBasicNodes: nodes } }),
  }, signal);
}

export async function startDemoTts(projectId: string, nodeId: string, signal: AbortSignal): Promise<void> {
  const current = await snapshot(projectId, signal);
  const node = current.state.workbenchBasicNodes?.find((item: { id: string }) => item.id === nodeId);
  if (node?.kind !== 'card.drama.audio' || node.data?.demoProfile !== 'local-test' || node.data?.demoProjectId !== projectId) {
    throw new Error('本地 TTS 启动仅支持同实例演示卡');
  }
  await json(`/api/apps/canvas/instances/${projectId}/actions/card.drama.audio.start-tts`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({ expectedRevision: current.revision, input: { nodeId, params: {} } }),
  }, signal);
}

const DEFAULT_VOICE_INSTRUCTION = '自然清晰的普通话解说';

export function effectiveLineVoice(data: Record<string, unknown>, lineId: string): string {
  const overrides = data.lineVoiceInstructions as Record<string, unknown> | undefined;
  const override = overrides?.[lineId];
  if (typeof override === 'string' && override.trim() && override.length <= 200) return override.trim();
  return voiceInstructionOf(data)?.trim() ?? DEFAULT_VOICE_INSTRUCTION;
}

export function lineGenerationCurrent(data: Record<string, unknown>, lineId: string, text: string): boolean {
  const texts = data.generatedLineTexts as Record<string, unknown> | undefined;
  const voices = data.generatedLineVoices as Record<string, unknown> | undefined;
  return texts?.[lineId] === text && voices?.[lineId] === effectiveLineVoice(data, lineId);
}

function generationInput(data: Record<string, unknown>): string {
  return JSON.stringify({ lines: data.rewriteLines, videoRef: data.videoRef, sourceRevision: data.sourceRevision,
    voiceInstruction: data.voiceInstruction, lineVoiceInstructions: data.lineVoiceInstructions });
}

function voiceInstructionOf(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const value = (data as Record<string, unknown>).voiceInstruction;
  return typeof value === 'string' && value.trim() && value.length <= 200 ? value : null;
}

async function generateTake(projectId: string, text: string, voiceInstruction: string | null, signal: AbortSignal) {
  const origin = 'http://127.0.0.1:8808';
  signal = AbortSignal.any([signal, AbortSignal.timeout(600_000)]);
  const started = await json(`${origin}/gradio_api/call/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data: [text, voiceInstruction && voiceInstruction.trim() ? voiceInstruction.trim() : DEFAULT_VOICE_INSTRUCTION, null, false, '', 2, false, false, 10, 42] }),
  }, signal);
  if (typeof started.event_id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(started.event_id)) throw new Error('TTS 未返回任务标识');
  const response = await fetch(`${origin}/gradio_api/call/generate/${started.event_id}`, { signal, redirect: 'error' });
  if (!response.ok) throw new Error(`TTS 结果读取失败 HTTP ${response.status}`);
  const events = await response.text();
  const complete = events.split('\n\n').find(event => event.includes('event: complete'));
  const payload = complete?.split('\n').find(line => line.startsWith('data: '))?.slice(6);
  if (!payload) throw new Error('TTS 生成失败或结果不确定；不会自动重试');
  const output = JSON.parse(payload)[0];
  if (typeof output?.url !== 'string') throw new Error('TTS 未返回音频文件');
  const audioUrl = new URL(output.url, origin);
  if (audioUrl.origin !== origin || !audioUrl.pathname.startsWith('/gradio_api/file=')) throw new Error('TTS 返回了非本地音频资源');
  const audioResponse = await fetch(audioUrl, { signal, redirect: 'error' });
  if (!audioResponse.ok) throw new Error('TTS 音频下载失败');
  const bytes = await audioResponse.arrayBuffer();
  if (bytes.byteLength > 30_000_000 || bytes.byteLength < 44) throw new Error('音频大小不符合 demo 限制');
  const context = new AudioContext();
  let durationMs: number;
  try { durationMs = Math.round((await context.decodeAudioData(bytes.slice(0))).duration * 1000); }
  finally { await context.close(); }
  if (durationMs <= 0) throw new Error('音频时长不可用');
  const form = new FormData();
  form.set('dir', 'outputs/voice');
  const filename = `voxcpm-${crypto.randomUUID()}.wav`;
  form.append('files', new Blob([bytes], { type: 'audio/wav' }), filename);
  const uploaded = await json(`/api/projects/${projectId}/upload`, { method: 'POST', body: form }, signal);
  const audioRef = uploaded.files?.find((file: { originalName: string }) => file.originalName === filename)?.name;
  if (typeof audioRef !== 'string') throw new Error('音频上传未返回工程引用');
  return { audioRef, durationMs };
}

export async function synthesizeDemoScript(projectId: string, nodeId: string, script: string, signal: AbortSignal): Promise<void> {
  if (!script.trim() || script.length > 20_000) throw new Error('稿件必须为 1–20000 字符');
  const before = await snapshot(projectId, signal);
  const source = before.state.workbenchBasicNodes?.find((node: { id: string }) => node.id === nodeId);
  if (source?.data?.script !== script) throw new Error('请先保存稿件，再生成配音');
  await startDemoTts(projectId, nodeId, signal);
  const { audioRef, durationMs } = await generateTake(projectId, script, voiceInstructionOf(source?.data), signal);
  const current = await snapshot(projectId, signal);
  const target = current.state.workbenchBasicNodes?.find((node: { id: string }) => node.id === nodeId);
  if (target?.data?.script !== script || target?.data?.videoRef !== source.data.videoRef) throw new Error('生成期间稿件或视频已变更；音频已保留，未覆盖编辑卡');
  await json(`/api/apps/canvas/instances/${projectId}/actions/card.drama.audio.attach`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({ expectedRevision: current.revision, input: { nodeId, params: { audioRef, durationMs, segments: [{ id: 'tts-full', label: 'VoxCPM 全稿配音（未做镜头对齐）', startMs: 0, endMs: durationMs, gapMs: 0, gain: 1, muted: false }] } } }),
  }, signal);
}

export async function callDemoAction(projectId: string, nodeId: string, verb: 'analyze' | 'compose', params: Record<string, unknown>) {
  const current = await snapshot(projectId);
  const node = current.state.workbenchBasicNodes?.find((item: { id: string }) => item.id === nodeId);
  if (!node || node.kind !== 'card.drama.audio') throw new Error('目标编辑卡不存在');
  if (verb === 'compose' && params.script !== node.data?.script) throw new Error('稿件尚未保存，请保存后再调用');
  await json(`/api/apps/canvas/instances/${projectId}/actions/card.drama.audio.${verb}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({ input: { nodeId, params }, expectedRevision: current.revision }),
  });
}

export async function transferRewriteToEditor(projectId: string, nodeId: string) {
  const current = await snapshot(projectId);
  const nodes = current.state.workbenchBasicNodes;
  const source = nodes?.find((node: { id: string }) => node.id === nodeId);
  const data = source?.data;
  if (!data?.rewriteLines?.length || data.stage !== 'rewrite') throw new Error('请先生成并检查改写台词');
  const checkedLines = validateRewriteLines(data.rewriteLines, data.videoDurationMs);
  if (data.rewriteDoc !== rewriteDocOf(checkedLines)) throw new Error('改写结果尚未保存完整');
  const targetId = data.downstreamNodeId;
  if (typeof targetId !== 'string' || targetId === nodeId) throw new Error('下游卡片引用无效');
  const target = nodes.find((node: { id: string }) => node.id === targetId);
  if (!target || target.data?.stage !== 'edit') throw new Error('下游配音编辑卡不存在');
  if (target.data.segments?.length && !window.confirm('交付新稿将替换下游编辑稿，旧音频文件仍保留。是否继续？')) return;
  const next = nodes.map((node: { id: string; data: Record<string, unknown> }) => node.id === targetId ? {
    ...node, data: { ...node.data, script: data.rewriteLines.map((line: { text: string }) => line.text).join('\n'), rewriteLines: data.rewriteLines,
      videoRef: data.videoRef, videoDurationMs: data.videoDurationMs, sourceNodeId: nodeId, sourceRevision: current.revision,
      rewriteProvider: data.rewriteProvider, audioRef: null, durationMs: 0, segments: [], confirmedLineIds: [], generatedLineTexts: {}, ttsStatus: '未生成' },
  } : node);
  await patchNodes(projectId, current, next);
}

export async function ensureDubbingListCard(projectId: string, nodeId: string, signal?: AbortSignal): Promise<string> {
  const current = await snapshot(projectId, signal);
  const nodes = current.state.workbenchBasicNodes;
  const source = nodes?.find((item: { id: string }) => item.id === nodeId);
  if (source?.kind !== 'card.drama.audio' || source.data?.stage !== 'edit') throw new Error('配音编辑源卡不存在');
  const existing = nodes.find((item: { kind: string; data?: Record<string, unknown> }) => item.kind === 'card.drama.audio'
    && item.data?.stage === 'line-list' && item.data?.sourceNodeId === nodeId);
  if (existing) return existing.id;
  const id = `dubbing-list-${crypto.randomUUID()}`;
  await patchNodes(projectId, current, [...nodes, { id, kind: 'card.drama.audio', title: '③ 配音句列表与细节编辑',
    x: Number(source.x ?? 0) + Number(source.width ?? 720) + 40, y: Number(source.y ?? 0), width: 680, height: 490,
    demoProfile: 'local-test', demoProjectId: projectId,
    data: { stage: 'line-list', demoProfile: 'local-test', demoProjectId: projectId, sourceNodeId: nodeId } }], signal);
  return id;
}

export async function readDubbingListSource(projectId: string, sourceNodeId: string, signal: AbortSignal) {
  const current = await snapshot(projectId, signal);
  const source = current.state.workbenchBasicNodes?.find((item: { id: string }) => item.id === sourceNodeId);
  if (source?.kind !== 'card.drama.audio' || source.data?.stage !== 'edit') throw new Error('配音源卡已删除或不再是编辑卡');
  return source;
}

export async function patchDubbingListSource(projectId: string, sourceNodeId: string, expectedData: Record<string, unknown>, nextData: Record<string, unknown>, signal: AbortSignal) {
  const current = await snapshot(projectId, signal);
  const source = current.state.workbenchBasicNodes?.find((item: { id: string }) => item.id === sourceNodeId);
  if (source?.data?.stage !== 'edit' || JSON.stringify(source.data) !== JSON.stringify(expectedData)) throw new Error('配音源卡已变化，请读回后重新编辑');
  await patchNodes(projectId, current, current.state.workbenchBasicNodes.map((item: { id: string }) => item.id === sourceNodeId
    ? { ...source, data: nextData } : item), signal);
}

export async function synthesizeDemoLines(projectId: string, nodeId: string, signal: AbortSignal, onProgress: (message: string) => void, onlyLineId?: string) {
  let current = await snapshot(projectId, signal);
  let node = current.state.workbenchBasicNodes?.find((item: { id: string }) => item.id === nodeId);
  if (node?.data?.stage !== 'edit' || !Array.isArray(node.data.rewriteLines) || !node.data.rewriteLines.length) throw new Error('请先从改写卡交付台词');
  const input = generationInput(node.data);
  const lines = node.data.rewriteLines as { id: string; text: string; videoStartMs: number; videoEndMs: number }[];
  if (lines.length > 80 || lines.reduce((sum, line) => sum + line.text.length, 0) > 20_000) throw new Error('台词数量或总字数超限');
  if (new Set(lines.map(line => line.id)).size !== lines.length || lines.some(line => !/^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/.test(line.id) || typeof line.text !== 'string' || !line.text.trim() || line.text.length > 2000 || !Number.isFinite(line.videoStartMs) || !Number.isFinite(line.videoEndMs) || line.videoStartMs < 0 || line.videoEndMs <= line.videoStartMs || line.videoEndMs > node.data.videoDurationMs)) throw new Error('台词或建议区间不合法');
  const gains = node.data.lineGains as Record<string, unknown> | undefined;
  const overrides = node.data.lineVoiceInstructions as Record<string, unknown> | undefined;
  if (gains && Object.values(gains).some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2)) throw new Error('本句音量必须为 0..2');
  if (overrides && Object.values(overrides).some(value => typeof value !== 'string' || value.length > 200)) throw new Error('本句音色描述最多 200 字符');
  if (onlyLineId && !lines.some(line => line.id === onlyLineId)) throw new Error('目标台词不存在');
  onProgress('正在检查并启动本地 TTS，首次合成将加载模型，请勿重复提交');
  await startDemoTts(projectId, nodeId, signal);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (onlyLineId && line.id !== onlyLineId) continue;
    current = await snapshot(projectId, signal);
    node = current.state.workbenchBasicNodes.find((item: { id: string }) => item.id === nodeId);
    if (generationInput(node.data) !== input) throw new Error('台词或视频已变化，请停止后重新确认');
    if (lineGenerationCurrent(node.data, line.id, line.text) && node.data.segments?.some((segment: { id: string }) => segment.id === line.id)) continue;
    onProgress(`逐句配音 ${index + 1}/${lines.length}，请勿重复提交`);
    await patchNodes(projectId, current, current.state.workbenchBasicNodes.map((item: { id: string; data: Record<string, unknown> }) => item.id === nodeId
      ? { ...item, data: { ...item.data, ttsStatus: `正在生成 ${index + 1}/${lines.length}`, ttsActiveLineId: line.id } } : item), signal);
    const voice = effectiveLineVoice(node.data, line.id);
    const take = await generateTake(projectId, line.text, voice, signal);
    current = await snapshot(projectId, signal);
    node = current.state.workbenchBasicNodes.find((item: { id: string }) => item.id === nodeId);
    if (generationInput(node.data) !== input) throw new Error('生成期间输入变化；音频已保留，未回填');
    const old = node.data.segments?.find((segment: { id: string }) => segment.id === line.id);
    const segment = { id: line.id, label: line.text, startMs: 0, endMs: take.durationMs, gapMs: old?.gapMs ?? 0, gain: old?.gain ?? node.data.lineGains?.[line.id] ?? 1,
      muted: old?.muted ?? false, videoStartMs: old?.videoStartMs ?? line.videoStartMs, videoEndMs: old?.videoEndMs ?? line.videoEndMs, audioRefOverride: take.audioRef };
    const segments = [...(node.data.segments ?? []).filter((item: { id: string }) => item.id !== line.id), segment];
    const next = current.state.workbenchBasicNodes.map((item: { id: string; data: Record<string, unknown> }) => item.id === nodeId ? {
      ...item, data: { ...item.data, audioRef: item.data.audioRef ?? take.audioRef, durationMs: Math.max(Number(item.data.durationMs ?? 0), take.durationMs), segments,
        generatedLineTexts: { ...(item.data.generatedLineTexts as Record<string, string> ?? {}), [line.id]: line.text },
        generatedLineVoices: { ...(item.data.generatedLineVoices as Record<string, string> ?? {}), [line.id]: voice }, ttsActiveLineId: null, ttsStatus: `已生成 ${index + 1}/${lines.length}` },
    } : item);
    await patchNodes(projectId, current, next, signal);
  }
  onProgress('逐句配音已回填；请确认视频区间并载入同步试听');
}
