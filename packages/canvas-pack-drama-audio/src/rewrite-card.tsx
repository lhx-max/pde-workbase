import React from 'react';
import type { CardRenderProps } from '@bezier/canvas-card-sdk';
import { demoMediaUrl, demoProjectOf, transferRewriteToEditor } from './demo-adapter';
import { DEFAULT_REWRITE_PROMPT, REWRITE_BODY_MAX_BYTES, REWRITE_FRAME_MAX_BYTES, rewriteDocOf, validateRewriteInput, validateRewriteLines, validateRewriteRequest, type RewriteFrame, type RewriteLine, type VideoRewriteInput } from './rewrite';

function waitForVideo(video: HTMLVideoElement, event: string, signal: AbortSignal, start: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener(event, done);
      video.removeEventListener('error', failed);
      signal.removeEventListener('abort', aborted);
    };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('视频无法解码或采样失败')); };
    const aborted = () => { cleanup(); reject(new DOMException('停止等待', 'AbortError')); };
    const timer = setTimeout(failed, 15_000);
    video.addEventListener(event, done, { once: true });
    video.addEventListener('error', failed, { once: true });
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    try { start(); } catch (error) { cleanup(); reject(error); }
  });
}

async function sampleVideoFrames(url: string, durationMs: number, signal: AbortSignal): Promise<RewriteFrame[]> {
  const response = await fetch(url, { signal, redirect: 'error' });
  if (!response.ok) throw new Error(`视频读取失败 HTTP ${response.status}`);
  const blob = await response.blob();
  signal.throwIfAborted();
  const objectUrl = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  try {
    await waitForVideo(video, 'loadeddata', signal, () => { video.src = objectUrl; video.load(); });
    if (!Number.isFinite(video.duration) || Math.round(video.duration * 1000) !== durationMs || !video.videoWidth || !video.videoHeight) throw new Error('视频时长与已保存节点不同，请先保存正确时长');
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器无法抽取视频帧');
    const count = Math.min(12, durationMs);
    const frames: RewriteFrame[] = [];
    for (let index = 0; index < count; index += 1) {
      signal.throwIfAborted();
      const atMs = Math.floor(index * durationMs / count);
      if (video.currentTime !== atMs / 1000) await waitForVideo(video, 'seeked', signal, () => { video.currentTime = atMs / 1000; });
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      let image = '';
      for (const quality of [0.75, 0.55, 0.35, 0.15]) {
        image = canvas.toDataURL('image/jpeg', quality);
        const base64 = image.slice('data:image/jpeg;base64,'.length);
        if (base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0) <= REWRITE_FRAME_MAX_BYTES) break;
      }
      frames.push({ atMs, image });
    }
    return frames;
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

async function requestJson(path: string, signal: AbortSignal, init?: RequestInit) {
  const response = await fetch(path, { ...init, signal, redirect: 'error' });
  const body = await response.json();
  if (!response.ok || body.ok === false) throw new Error(body.error?.message ?? body.error?.code ?? `HTTP ${response.status}`);
  return body;
}

async function savedState(projectId: string, nodeId: string, input: VideoRewriteInput, signal: AbortSignal) {
  const health = await requestJson('/api/health', signal);
  if (health.storage?.canvas !== 'explicit-local-runtime') throw new Error('改写调用仅支持显式本地 demo，未验收云端');
  const { data } = await requestJson(`/api/apps/canvas/instances/${encodeURIComponent(projectId)}/state`, signal);
  const current = data?.state?.workbenchBasicNodes?.find((item: { id: string }) => item.id === nodeId);
  if (current?.kind !== 'card.drama.audio' || current.data?.stage !== 'rewrite') throw new Error('已保存的改写卡不存在');
  if (current.data.script !== input.script || current.data.rewritePrompt !== input.prompt || current.data.videoRef !== input.videoRef || current.data.videoDurationMs !== input.videoDurationMs) throw new Error('原稿、prompt、视频或时长尚未保存，请保存后再改写');
  if (!Number.isSafeInteger(data.revision) || data.revision < 0) throw new Error('画布未返回有效 revision');
  return { revision: data.revision as number, node: current };
}

function waitForDelivery(task: Promise<unknown>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new DOMException('停止等待', 'AbortError'));
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    task.then(() => { signal.removeEventListener('abort', aborted); resolve(); }, error => { signal.removeEventListener('abort', aborted); reject(error); });
  });
}

const fieldStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: 6, borderRadius: 4, border: '1px solid var(--border-default, #d9d9d9)', background: 'var(--bg-app, #fff)', color: 'var(--text-primary, #1a1a1a)', fontSize: 12 };
const buttonStyle: React.CSSProperties = { padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border-default, #d9d9d9)', background: 'var(--bg-app, #fff)', color: 'var(--text-primary, #1a1a1a)', cursor: 'pointer' };

export function RewriteCard(props: CardRenderProps) {
  const { node, onPatch } = props;
  const data = node.data ?? {};
  const projectId = demoProjectOf(node);
  const [scriptDraft, setScriptDraft] = React.useState<string | null>(null);
  const [promptDraft, setPromptDraft] = React.useState<string | null>(null);
  const [durationDraft, setDurationDraft] = React.useState<number | null>(null);
  const [linesDraft, setLinesDraft] = React.useState<RewriteLine[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const controllerRef = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => controllerRef.current?.abort(), []);
  React.useEffect(() => {
    controllerRef.current?.abort();
    setScriptDraft(null);
    setPromptDraft(null);
    setDurationDraft(null);
    setLinesDraft(null);
    setStatus(null);
  }, [node.id]);
  const script = scriptDraft ?? (typeof data.script === 'string' ? data.script : '');
  const prompt = promptDraft ?? (typeof data.rewritePrompt === 'string' ? data.rewritePrompt : DEFAULT_REWRITE_PROMPT);
  const duration = durationDraft ?? (typeof data.videoDurationMs === 'number' ? data.videoDurationMs : 0);
  const lines = linesDraft ?? (Array.isArray(data.rewriteLines) ? data.rewriteLines as RewriteLine[] : []);
  const dirty = scriptDraft !== null || promptDraft !== null || durationDraft !== null || linesDraft !== null;
  let videoUrl: string | undefined;
  let mediaError: string | null = null;
  try { if (projectId && typeof data.videoRef === 'string') videoUrl = demoMediaUrl(projectId, data.videoRef); }
  catch (error) { mediaError = error instanceof Error ? error.message : '视频引用非法'; }

  const save = () => {
    try {
      const input = validateRewriteInput({ script: scriptDraft === null && data.script === null ? null : script, prompt, videoRef: data.videoRef, videoDurationMs: duration });
      const checked = lines.length ? validateRewriteLines(lines, duration) : [];
      onPatch({ data: { ...node.data, script: input.script, rewritePrompt: input.prompt, videoDurationMs: input.videoDurationMs, ...(linesDraft !== null ? { rewriteLines: checked, rewriteDoc: rewriteDocOf(checked) } : {}), rewriteConfirmed: false } });
      setScriptDraft(null);
      setPromptDraft(null);
      setDurationDraft(null);
      setLinesDraft(null);
      setStatus('已提交保存；改写或交付前将核对服务端已保存节点。');
    } catch (error) { setStatus(error instanceof Error ? error.message : '保存失败'); }
  };

  const runRewrite = async () => {
    if (controllerRef.current || !projectId || !videoUrl) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setStatus('正在核对已保存节点并采样视频；不会自动重试。');
    try {
      if (dirty) throw new Error('请先点击保存');
      const input = validateRewriteInput({ script: data.script, prompt: data.rewritePrompt, videoRef: data.videoRef, videoDurationMs: data.videoDurationMs });
      const before = await savedState(projectId, node.id, input, controller.signal);
      const frames = await sampleVideoFrames(videoUrl, input.videoDurationMs, controller.signal);
      const params = validateRewriteRequest({ ...input, frames });
      const body = JSON.stringify({ expectedRevision: before.revision, input: { nodeId: node.id, params } });
      if (new TextEncoder().encode(body).byteLength > REWRITE_BODY_MAX_BYTES) throw new Error('采样请求总大小超过 1.2MB，请减少采样帧');
      setStatus('正在调用视觉模型改写；采样帧仅用于本次请求，不会保存到卡片。');
      await requestJson(`/api/apps/canvas/instances/${encodeURIComponent(projectId)}/actions/card.drama.audio.rewrite`, controller.signal, {
        method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body,
      });
      setStatus('改写完成，等待画布读回；台词和时间区间尚未人工确认。');
    } catch (error) {
      setStatus(controller.signal.aborted ? '已停止等待；服务端可能继续执行，请读回结果，不会自动重试。' : error instanceof Error ? error.message : '改写失败');
    } finally {
      if (controllerRef.current === controller) { controllerRef.current = null; setBusy(false); }
    }
  };

  const deliver = async () => {
    if (!projectId || controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setStatus('正在核对已保存台词并交给配音编辑卡。');
    try {
      if (dirty) throw new Error('请先保存修改后的台词');
      const input = validateRewriteInput({ script: data.script, prompt: data.rewritePrompt, videoRef: data.videoRef, videoDurationMs: data.videoDurationMs });
      const checked = validateRewriteLines(lines, input.videoDurationMs);
      const saved = await savedState(projectId, node.id, input, controller.signal);
      const source = saved.node.data.rewriteInput;
      if (!source || source.script !== input.script || source.prompt !== input.prompt || source.videoRef !== input.videoRef || source.videoDurationMs !== input.videoDurationMs) throw new Error('生成结果引用的原稿、prompt 或视频已变更，请重新改写后确认');
      if (JSON.stringify(saved.node.data.rewriteLines) !== JSON.stringify(checked) || saved.node.data.rewriteDoc !== rewriteDocOf(checked)) throw new Error('台词尚未保存或已变更，请读回后再确认');
      controller.signal.throwIfAborted();
      await waitForDelivery(Promise.resolve(transferRewriteToEditor(projectId, node.id)), controller.signal);
      setStatus('已确认交给配音编辑卡；配音生成和镜头对齐需在编辑卡继续处理。');
    } catch (error) { setStatus(controller.signal.aborted ? '已停止等待；交付可能继续执行，请读回，不会自动重试。' : error instanceof Error ? error.message : '交付失败'); }
    finally { controllerRef.current = null; setBusy(false); }
  };

  const editLine = (index: number, patch: Partial<RewriteLine>) => setLinesDraft(lines.map((line, at) => at === index ? { ...line, ...patch } : line));
  return <div className="nodrag nopan" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, fontSize: 12, color: 'var(--text-primary, #1a1a1a)' }}>
    <strong>视频台词改写</strong>
    {videoUrl ? <video src={videoUrl} controls playsInline preload="metadata" style={{ width: '100%', maxHeight: 260 }} onLoadedMetadata={event => {
      const ms = Math.round(event.currentTarget.duration * 1000);
      if (Number.isSafeInteger(ms) && ms > 0 && ms !== data.videoDurationMs) setDurationDraft(ms);
    }} onError={() => setStatus('绑定视频无法播放，请检查视频资源和浏览器解码支持。')} /> : <div role="status">{mediaError ?? '未绑定同项目本地 demo 视频，改写不可用。'}</div>}
    <div>视频时长：{duration}ms</div>
    <label>原稿<textarea disabled={busy} style={fieldStyle} rows={5} maxLength={20_000} value={script} onChange={event => setScriptDraft(event.target.value)} /></label>
    <label>改写要求<textarea disabled={busy} style={fieldStyle} rows={4} maxLength={20_000} value={prompt} onChange={event => setPromptDraft(event.target.value)} /></label>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button style={buttonStyle} disabled={busy} onClick={save}>保存原稿、改写要求与台词</button>
      <button style={buttonStyle} disabled={busy || dirty || !videoUrl || !projectId} onClick={() => void runRewrite()}>采样视频并改写</button>
      {busy && <button style={buttonStyle} onClick={() => controllerRef.current?.abort()}>停止等待（不自动重跑）</button>}
    </div>
    <div>最多 12 张 320px JPEG 采样帧；不是连续视频或音轨，不能证明未采样期间的内容。</div>
    {lines.length > 0 && <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <strong>生成台词 · {typeof data.rewriteProvider === 'string' ? data.rewriteProvider : '未知来源'} · {data.rewriteConfirmed === true && !dirty ? '已确认' : '未确认'}</strong>
      {lines.map((line, index) => <div key={line.id}>
        <label>台词 {index + 1}<textarea disabled={busy} style={fieldStyle} value={line.text} maxLength={2_000} onChange={event => editLine(index, { text: event.target.value })} /></label>
        <label>视频起 ms<input disabled={busy} type="number" min={0} max={duration} step={1} value={line.videoStartMs} onChange={event => editLine(index, { videoStartMs: event.target.valueAsNumber })} /></label>
        <label>视频止 ms<input disabled={busy} type="number" min={0} max={duration} step={1} value={line.videoEndMs} onChange={event => editLine(index, { videoEndMs: event.target.valueAsNumber })} /></label>
      </div>)}
      <button style={buttonStyle} disabled={busy || dirty || !projectId} onClick={() => void deliver()}>确认交给配音编辑卡</button>
    </section>}
    {status && <div role="status" aria-live="polite">{status}</div>}
  </div>;
}
