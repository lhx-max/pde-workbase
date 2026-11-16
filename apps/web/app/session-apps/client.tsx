'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DubbingEditor, synthesizeDemoLines, changeRewriteWindow, validateRewriteLines } from '@bezier/canvas-pack-drama-audio';
import { helpText, parseCommand } from './command-script';
import styles from './workbench.module.css';

/** 实时工作台：左列语言交互（本地指令优先，未命中转发真实 Agent）+ 提示词；
 * 右列上部为小展示区（视频 + 配音前后双音轨）与导入/配音初步生成工具条，
 * 下部为完整配音编辑区（直接渲染 DubbingEditor，写回画布存储）。 */

interface Message { role: 'user' | 'assistant' | 'system'; text: string; streaming?: boolean }
interface ProjectSummary { id: string; title?: string; name?: string }
interface CanvasNode { id: string; kind: string; data?: Record<string, unknown>; [key: string]: unknown }
interface EditorSegment { id: string; text?: string; label?: string; muted?: boolean; videoStartMs?: number | null; videoEndMs?: number | null }

const INSTANCE_ID = 'ai_000000000000000000000001';
const SESSION_ID = 'local_dev_session';
const DEMO_PROJECT = 'drama-demo-5d85c5e8-5a1a-4ee6-be99-557ab015ec42';

const QUICK_CHIPS: string[] = ['导入素材', '导入配音', '台词导入', '读取便签', '列出项目', '打开项目 drama-demo', '帮助'];
const AGENT_CHIPS: string[] = ['帮我写一段第三人称短剧解说词', '总结当前配音稿的要点', '把解说词改得更口语化'];

async function noteAction(actionId: 'notes.read' | 'notes.add', input: Record<string, unknown>, expectedRevision?: number) {
  const response = await fetch(`/api/ma-v/application-instances/${INSTANCE_ID}/actions/${actionId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: SESSION_ID, input, ...(expectedRevision !== undefined ? { expectedRevision } : {}) }),
  });
  const body = await response.json().catch(() => null) as { ok?: boolean; error?: { code?: string; message?: string }; result?: { summary: string; revision: number; data: { notes?: string[] } } } | null;
  if (!response.ok || !body || body.ok === false || !body.result) {
    if (body?.error?.code === 'PROVIDER_UNAVAILABLE') throw new Error(body.error.message ?? '本机便签服务未启动');
    throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  }
  return body.result;
}

async function listProjects(): Promise<ProjectSummary[]> {
  const response = await fetch('/api/projects');
  const body = await response.json().catch(() => null) as { projects?: ProjectSummary[] } | null;
  if (!response.ok || !Array.isArray(body?.projects)) throw new Error('画布项目列表读取失败');
  return body.projects;
}

function findProject(projects: ProjectSummary[], target: string): ProjectSummary | undefined {
  const lower = target.toLowerCase();
  return projects.find(project => project.id.toLowerCase() === lower)
    ?? projects.find(project => (project.title ?? project.name ?? '').toLowerCase() === lower)
    ?? projects.find(project => (project.title ?? project.name ?? '').toLowerCase().includes(lower)
      || project.id.toLowerCase().includes(lower));
}

async function uploadProjectFile(projectId: string, file: File, dir: string): Promise<string> {
  const form = new FormData();
  form.set('dir', dir);
  form.append('files', file, file.name);
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/upload`, { method: 'POST', body: form });
  const body = await response.json().catch(() => null) as { files?: { name?: string; originalName?: string }[] } | null;
  if (!response.ok || !Array.isArray(body?.files)) throw new Error(`素材上传失败 HTTP ${response.status}`);
  const uploaded = body.files.find(item => item.originalName === file.name);
  if (typeof uploaded?.name !== 'string' || !uploaded.name) throw new Error('上传结果未返回工程引用');
  return uploaded.name;
}

export default function SessionAppsClient() {
  const [messages, setMessages] = useState<Message[]>([{ role: 'system', text: helpText() }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [iframeSrc, setIframeSrc] = useState('/');
  const [editorNode, setEditorNode] = useState<CanvasNode | null>(null);
  const [editorError, setEditorError] = useState('');
  const previewVideo = useRef<HTMLVideoElement>(null);
  const editorPanel = useRef<HTMLDetailsElement>(null);
  const [videoSize, setVideoSize] = useState({ width: 16, height: 9, durationMs: 0 });
  const [previewMs, setPreviewMs] = useState(0);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [trackView, setTrackView] = useState<'all' | 'focused'>('all');
  const [trackZoom, setTrackZoom] = useState(1);
  const trackDrag = useRef<{ line: EditorSegment; x: number; width: number; span: number; mode: 'move' | 'start' | 'end'; delta: number } | null>(null);
  const [toolStatus, setToolStatus] = useState('');
  const [generating, setGenerating] = useState(false);
  const [welcomeShown, setWelcomeShown] = useState(false);
  const [welcomeHiding, setWelcomeHiding] = useState(false);
  const enterWorkbench = useCallback(() => {
    setWelcomeHiding(true);
    setTimeout(() => setWelcomeShown(true), 340);
  }, []);
  const messagesRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef<string>(DEMO_PROJECT);
  const generateController = useRef<AbortController | null>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const voiceInput = useRef<HTMLInputElement>(null);
  const scriptInput = useRef<HTMLInputElement>(null);
  useEffect(() => { messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight }); }, [messages]);
  const push = useCallback((message: Message) => setMessages(previous => [...previous, message]), []);

  const refreshEditor = useCallback(async (projectId: string) => {
    try {
      const response = await fetch(`/api/apps/canvas/instances/${encodeURIComponent(projectId)}/state`);
      const body = await response.json().catch(() => null) as { data?: { state?: { workbenchBasicNodes?: CanvasNode[] } } } | null;
      if (!response.ok || !Array.isArray(body?.data?.state?.workbenchBasicNodes)) throw new Error('画布状态读取失败');
      const node = body.data.state.workbenchBasicNodes.find(item => item.kind === 'card.drama.audio' && item.data?.stage === 'edit');
      setEditorNode(node ?? null);
      setEditorError(node ? '' : '当前项目暂无配音编辑卡；请先在改写卡交付台词。');
    } catch (reason) {
      setEditorNode(null);
      setEditorError(reason instanceof Error ? reason.message : '配音编辑区加载失败');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      await refreshEditor(projectRef.current);
      if (!controller.signal.aborted) timer = setTimeout(refresh, 1000);
    };
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [refreshEditor]);
  useEffect(() => {
    let frame = 0;
    const update = () => { setPreviewMs((previewVideo.current?.currentTime ?? 0) * 1000); frame = requestAnimationFrame(update); };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => () => generateController.current?.abort(), []);

  const patchEditorNode = useCallback(async (patch: { data?: Record<string, unknown> }) => {
    const projectId = projectRef.current;
    const target = editorNode;
    if (!target) return;
    try {
      const stateResponse = await fetch(`/api/apps/canvas/instances/${encodeURIComponent(projectId)}/state`);
      const stateBody = await stateResponse.json().catch(() => null) as { data?: { revision?: number; state?: { workbenchBasicNodes?: CanvasNode[] } } } | null;
      if (!stateResponse.ok || !Array.isArray(stateBody?.data?.state?.workbenchBasicNodes) || !Number.isFinite(stateBody?.data?.revision)) throw new Error('画布状态读取失败');
      const savedTarget = stateBody.data.state.workbenchBasicNodes.find(node => node.id === target.id);
      if (!savedTarget || JSON.stringify(savedTarget.data) !== JSON.stringify(target.data)) throw new Error('编辑期间数据已变化，请读回后重试');
      const nodes = stateBody.data.state.workbenchBasicNodes.map(node => node.id === target.id
        ? { ...node, ...patch, data: { ...(node.data ?? {}), ...(patch.data ?? {}) } } : node);
      const patchResponse = await fetch(`/api/projects/${encodeURIComponent(projectId)}/canvas/state`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: stateBody.data.revision, changes: { workbenchBasicNodes: nodes } }),
      });
      if (!patchResponse.ok) throw new Error(`保存失败 HTTP ${patchResponse.status}`);
      await refreshEditor(projectId);
    } catch (reason) {
      setEditorError(reason instanceof Error ? reason.message : '编辑保存失败；请重试');
    }
  }, [editorNode, refreshEditor]);

  async function runAgentTurn(prompt: string) {
    const response = await fetch('/api/ma-v/agent/run', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    const body = await response.json().catch(() => null) as { ok?: boolean; runId?: string; error?: { code?: string; message?: string } } | null;
    if (!response.ok || !body?.ok || !body.runId) {
      push({ role: 'system', text: body?.error?.code === 'AGENT_UNAVAILABLE' ? '真实 Agent 未配置：按接入 SOP 在 apps/web/.env.local 配置 MANAGED_AGENT_*（含你的 MyFlicker Cookie）后重启；本地指令仍可用。' : body?.error?.message ?? `Agent 请求失败 HTTP ${response.status}` });
      return;
    }
    await new Promise<void>(resolve => {
      const source = new EventSource(`/api/ma-v/agent/run/${body.runId}/events`);
      let assistantIndex = -1;
      let full = '';
      const upsertAssistant = (delta: string) => {
        full += delta;
        setMessages(previous => {
          const next = [...previous];
          if (assistantIndex < 0) { assistantIndex = next.length; next.push({ role: 'assistant', text: delta, streaming: true }); }
          else next[assistantIndex] = { role: 'assistant', text: full, streaming: true };
          return next;
        });
      };
      source.addEventListener('agent', event => {
        const data = JSON.parse((event as MessageEvent).data) as { type: string; text?: string };
        if (data.type === 'text_delta' && data.text) upsertAssistant(data.text);
      });
      source.addEventListener('error', () => {
        if (assistantIndex < 0) push({ role: 'system', text: 'Agent 运行出错或连接中断；不自动重试。' });
        source.close(); resolve();
      });
      source.addEventListener('end', () => { source.close(); resolve(); });
    });
  }

  async function generateVoice() {
    const target = editorNode;
    if (!target || generating) return;
    const controller = new AbortController();
    generateController.current = controller;
    setGenerating(true);
    setToolStatus('正在启动本地 TTS 并逐句生成配音…');
    try {
      await synthesizeDemoLines(projectRef.current, target.id, controller.signal, message => setToolStatus(message));
      await refreshEditor(projectRef.current);
      setToolStatus('逐句配音已回填；请在编辑区确认区间并载入试听。');
    } catch (reason) {
      if (!controller.signal.aborted) {
        setToolStatus(reason instanceof Error ? reason.message : '逐句生成失败；不自动重试');
      } else setToolStatus('已停止生成；已生成音频保留。');
    } finally {
      if (generateController.current === controller) generateController.current = null;
      setGenerating(false);
    }
  }

  async function handleImport(kind: 'media' | 'voice' | 'script', file: File) {
    const projectId = projectRef.current;
    try {
      if (kind === 'media') {
        setToolStatus(`正在导入素材 ${file.name}…`);
        const ref = await uploadProjectFile(projectId, file, 'inputs/media');
        push({ role: 'system', text: `已导入素材「${file.name}」（${ref}），可在画布项目中使用。` });
        setToolStatus(`素材已导入：${ref}`);
        return;
      }
      if (kind === 'voice') {
        setToolStatus(`正在导入配音 ${file.name}…`);
        const ref = await uploadProjectFile(projectId, file, 'outputs/voice');
        await patchEditorNode({ data: { audioRef: ref } });
        push({ role: 'system', text: `已导入配音「${file.name}」并设为编辑卡配音主源；在编辑区载入即可试听。` });
        setToolStatus(`配音已导入：${ref}`);
        return;
      }
      setToolStatus(`正在导入台词 ${file.name}…`);
      const script = await file.text();
      if (!script.trim() || script.length > 20_000) throw new Error('台词文件需为 1–20000 字符文本');
      await patchEditorNode({ data: { script } });
      push({ role: 'system', text: `已导入台词「${file.name}」写入编辑卡稿件字段（${script.length} 字符）。` });
      setToolStatus('台词已导入并写入稿件。');
    } catch (reason) {
      const text = reason instanceof Error ? reason.message : '导入失败；不自动重试';
      push({ role: 'system', text });
      setToolStatus(text);
    }
  }

  async function handleSend(promptText?: string) {
    const prompt = (promptText ?? input).trim();
    if (!prompt || busy) return;
    if (promptText) setInput(promptText);
    else setInput('');
    setBusy(true);
    push({ role: 'user', text: prompt });
    try {
      const command = parseCommand(prompt);
      if (command?.kind === 'help') { push({ role: 'system', text: helpText() }); return; }
      if (command?.kind === 'media.import') { mediaInput.current?.click(); push({ role: 'system', text: '请选择要导入的素材文件（视频/图片）。' }); return; }
      if (command?.kind === 'voice.import') { voiceInput.current?.click(); push({ role: 'system', text: '请选择要导入的配音音频文件（wav/mp3）。' }); return; }
      if (command?.kind === 'script.import') { scriptInput.current?.click(); push({ role: 'system', text: '请选择要导入的台词文本文件（txt/md）。' }); return; }
      if (command?.kind === 'note.add') {
        const current = await noteAction('notes.read', {});
        const result = await noteAction('notes.add', { text: command.text }, current.revision);
        push({ role: 'system', text: result.summary });
        return;
      }
      if (command?.kind === 'notes.read') {
        const result = await noteAction('notes.read', {});
        push({ role: 'system', text: result.data.notes?.length ? `当前便签：${result.data.notes.join('；')}` : '暂无便签' });
        return;
      }
      if (command?.kind === 'projects.list') {
        const projects = await listProjects();
        push({ role: 'system', text: projects.length ? `画布项目（${projects.length} 个）：${projects.map(project => `${project.title ?? project.name ?? project.id}（${project.id}）`).join('；')}` : '暂无画布项目' });
        return;
      }
      if (command?.kind === 'project.open') {
        const projects = await listProjects();
        const target = findProject(projects, command.target);
        if (!target) { push({ role: 'system', text: `未找到匹配的画布项目：${command.target}` }); return; }
        projectRef.current = target.id;
        setIframeSrc(`/?projectId=${encodeURIComponent(target.id)}`);
        await refreshEditor(target.id);
        push({ role: 'system', text: `已在展示区打开「${target.title ?? target.name ?? target.id}」，配音编辑区已同步切换。` });
        return;
      }
      await runAgentTurn(prompt);
    } catch (reason) {
      push({ role: 'system', text: reason instanceof Error ? reason.message : '执行失败；不自动重试' });
    } finally {
      setBusy(false);
    }
  }

  const editorData = (editorNode?.data ?? {}) as { videoRef?: string | null; videoDurationMs?: number; segments?: EditorSegment[]; rewriteLines?: EditorSegment[]; confirmedLineIds?: string[] };
  const videoUrl = editorData.videoRef
    ? `/api/projects/${encodeURIComponent(projectRef.current)}/raw/${editorData.videoRef.split('/').map(encodeURIComponent).join('/')}`
    : '';
  const durationMs = videoSize.durationMs || Math.max(0, Number(editorData.videoDurationMs ?? 0));
  const segments = Array.isArray(editorData.segments) ? editorData.segments : [];
  const trackLines = Array.isArray(editorData.rewriteLines) ? editorData.rewriteLines.map(line => ({ ...line, ...segments.find(segment => segment.id === line.id) })) : segments;
  const voiced = trackLines.filter(segment => Number.isFinite(segment.videoStartMs) && Number.isFinite(segment.videoEndMs)
    && (segment.videoEndMs ?? 0) > (segment.videoStartMs ?? 0));
  const focusedLine = voiced.find(line => line.id === selectedLineId);
  const viewStart = trackView === 'focused' && focusedLine ? Math.max(0, (focusedLine.videoStartMs ?? 0) - 2000) : 0;
  const viewEnd = trackView === 'focused' && focusedLine ? Math.min(durationMs, (focusedLine.videoEndMs ?? 0) + 2000) : durationMs;
  const viewSpan = Math.max(1, viewEnd - viewStart);
  const cursorPercent = Math.max(0, Math.min(100, (previewMs - viewStart) / viewSpan * 100));
  const selectTrackLine = (line: EditorSegment) => {
    setSelectedLineId(line.id);
    if (editorPanel.current) editorPanel.current.open = true;
    if (previewVideo.current) previewVideo.current.currentTime = Math.max(0, line.videoStartMs ?? 0) / 1000;
  };
  const finishTrackDrag = async () => {
    const drag = trackDrag.current;
    trackDrag.current = null;
    if (!drag || Math.abs(drag.delta) < 1 || !editorNode) return;
    try {
      const next = changeRewriteWindow({ id: drag.line.id, text: drag.line.text ?? drag.line.label ?? '', videoStartMs: drag.line.videoStartMs!, videoEndMs: drag.line.videoEndMs! }, drag.delta, drag.mode, durationMs);
      const lines = (editorNode.data?.rewriteLines as { id: string; text: string; videoStartMs: number; videoEndMs: number }[]).map(line => line.id === next.id ? { ...line, videoStartMs: next.videoStartMs, videoEndMs: next.videoEndMs } : line);
      validateRewriteLines(lines, durationMs);
      await patchEditorNode({ data: { rewriteLines: lines, segments: segments.map(segment => segment.id === next.id ? { ...segment, videoStartMs: next.videoStartMs, videoEndMs: next.videoEndMs } : segment),
        confirmedLineIds: editorData.confirmedLineIds?.filter(id => id !== next.id) ?? [] } });
    } catch (reason) { setToolStatus(reason instanceof Error ? reason.message : '区间调整失败'); }
  };
  const seekTrack = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (previewVideo.current && rect.width > 0) previewVideo.current.currentTime = (viewStart + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * viewSpan) / 1000;
  };
  const bubbleClass = (role: Message['role']) => role === 'user' ? styles.bubbleUser : role === 'system' ? styles.bubbleSystem : styles.bubbleAssistant;

  const conversationPanel = <section className={styles.chat} aria-label="AI 交互面板">
        <div ref={messagesRef} role="log" aria-live="polite" className={styles.messages}>
          {messages.map((message, index) => <div key={index} className={`${styles.bubble} ${bubbleClass(message.role)}`}>{message.text}{message.streaming ? '▍' : ''}</div>)}
        </div>
        <div className={styles.composer}>
          <input aria-label="语言输入" className={styles.input}
            placeholder="描述当前句子的修改要求，或输入导入指令…"
            value={input} onChange={event => setInput(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void handleSend(); } }} />
          <button type="button" className={styles.send} disabled={busy || !input.trim()} onClick={() => void handleSend()}>{busy ? '…' : '发送'}</button>
        </div>
        <details className={styles.chips}>
          <summary className={styles.chipsTitle}>快捷指令与 AI 提示词</summary>
          <div className={styles.chipRow}>
            {QUICK_CHIPS.map(chip => <button type="button" key={chip} className={styles.chip} onClick={() => void handleSend(chip)}>{chip}</button>)}
            {AGENT_CHIPS.map(chip => <button type="button" key={chip} className={`${styles.chip} ${styles.chipAgent}`} onClick={() => void handleSend(chip)}>{chip}</button>)}
          </div>
        </details>
      </section>;

  return <main className={styles.shell}>
    {!welcomeShown && <div className={`${styles.welcomeOverlay} ${welcomeHiding ? styles.welcomeOverlayHide : ''}`} role="dialog" aria-label="欢迎界面" onClick={enterWorkbench}>
      <div className={`${styles.welcomeGlow} ${styles.welcomeGlowA}`} aria-hidden />
      <div className={`${styles.welcomeGlow} ${styles.welcomeGlowB}`} aria-hidden />
      <div className={`${styles.welcomeGlow} ${styles.welcomeGlowC}`} aria-hidden />
      <div className={styles.welcomeStars} aria-hidden />
      <div className={`${styles.welcomeRing} ${styles.welcomeRingA}`} aria-hidden />
      <div className={`${styles.welcomeRing} ${styles.welcomeRingB}`} aria-hidden />
      <div className={styles.welcomeGrid} aria-hidden />
      <div className={styles['ha-spectrum']} aria-hidden title="模拟音频节奏">
        {Array.from({ length: 96 }, (_, index) => <span key={index} className={styles['ha-spectrum-ray']}
          style={{ transform: `rotate(${index * 3.75}deg)` }}>
          <span className={styles['ha-spectrum-bar']} style={{ animationDelay: `${-(index * 0.137 % 2.4)}s`, animationDuration: `${1.1 + index % 7 * 0.17}s` }} />
        </span>)}
        <span className={styles['ha-radial-wave']} />
        <span className={styles['ha-radial-wave']} style={{ animationDelay: '-1s' }} />
        <span className={styles['ha-radial-wave']} style={{ animationDelay: '-2s' }} />
        <span className={styles['ha-hud-core']} />
      </div>
      <div className={styles.welcomeCard}>
        <span className={styles.welcomeIcon}>🎬</span>
        <p className={styles.welcomeBrand}>我是 DesignAI</p>
        <h2 className={styles.welcomeTitle}>欢迎导演</h2>
        <p className={styles.welcomeSub}>台词已就绪，随时开机</p>
        <p className={styles.welcomeTip}>任意点击即可开始</p>
      </div>
    </div>}
    <header className={styles.header}>
      <span className={styles.brandDot} />
      <h1 className={styles.title}>DesignAI 短剧导演</h1>
      <span className={`${styles.badge} ${styles.badgeOnline}`}>本地联调</span>
      <span className={styles.badge}>画布 + 配音 + Agent</span>
    </header>
    <div className={styles.grid}>
      {conversationPanel}
      <section className={styles.right} aria-label="画布与配音编辑">
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>展示区 · 配音前后对比</h2>
            <p className={styles.panelHint}>视频画面与双音轨：上轨原视频，下轨生成配音</p>
          </div>
          <div className={styles.preview}>
            <div className={styles.previewMedia}>
            {videoUrl
              ? <video ref={previewVideo} className={styles.previewVideo} style={{ aspectRatio: `${videoSize.width} / ${videoSize.height}`, width: `${300 * videoSize.width / videoSize.height}px` }}
                  src={videoUrl} controls preload="metadata" muted playsInline onLoadedMetadata={event => {
                    const video = event.currentTarget;
                    setVideoSize({ width: video.videoWidth || 16, height: video.videoHeight || 9, durationMs: video.duration * 1000 });
                  }} />
              : <div className={styles.previewVideo} role="status" style={{ display: 'grid', placeItems: 'center', color: '#8892a8', fontSize: 12 }}>暂无视频</div>}
            </div>
            <div className={styles.previewTracks}>
              <div className={styles.chipRow}>
                <button className={styles.chip} onClick={() => { setTrackView('all'); setTrackZoom(1); }}>全片概览</button>
                <button className={styles.chip} disabled={!selectedLineId} onClick={() => { setTrackView('focused'); setTrackZoom(1); }}>当前句放大</button>
                <label>缩放 <select aria-label="音轨缩放" value={trackZoom} onChange={event => setTrackZoom(Number(event.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
              </div>
              <div className={styles.timelineViewport}>
              <div style={{ width: `${trackZoom * 100}%` }}>
              <div className={styles.trackRow}>
                <span className={styles.trackLabel}>视频 / 原声</span>
                <div className={styles.trackBase} title="视频与原声共用主时钟" onClick={seekTrack}>
                  <div className={`${styles.trackSeg} ${styles.trackOriginal}`} style={{ left: 0, width: '100%' }} />
                  <div className={styles.trackCursor} style={{ left: `${cursorPercent}%` }} />
                </div>
              </div>
              <div className={styles.trackRow}>
                <span className={styles.trackLabel}>配音音轨</span>
                <div className={styles.trackBase} title={`配音区间 ${voiced.length} 句`} onClick={seekTrack}>
                  {durationMs > 0 && voiced.filter(line => (line.videoEndMs ?? 0) > viewStart && (line.videoStartMs ?? 0) < viewEnd).map(segment => {
                    const start = Math.max(0, (Math.max(viewStart, segment.videoStartMs ?? 0) - viewStart) / viewSpan * 100);
                    const width = Math.max(0, (Math.min(viewEnd, segment.videoEndMs ?? 0) - Math.max(viewStart, segment.videoStartMs ?? 0)) / viewSpan * 100);
                    const status = selectedLineId === segment.id ? 'editing' : editorData.confirmedLineIds?.includes(segment.id) ? 'complete' : 'pending';
                    return <button type="button" key={segment.id} data-preview-line-id={segment.id} data-edit-status={status}
                      className={`${styles.trackSeg} ${status === 'editing' ? styles.trackEditing : status === 'complete' ? styles.trackComplete : styles.trackPending}`}
                      style={{ left: `${start}%`, width: `${width}%` }} title={segment.label ?? segment.id}
                      aria-label={`编辑配音 ${segment.id}`} onPointerDown={event => {
                        if (event.button !== 0) return;
                        const rect = event.currentTarget.getBoundingClientRect();
                        const offset = event.clientX - rect.left;
                        const mode = rect.width > 24 && offset < 8 ? 'start' : rect.width > 24 && offset > rect.width - 8 ? 'end' : 'move';
                        trackDrag.current = { line: segment, x: event.clientX, width: event.currentTarget.parentElement!.getBoundingClientRect().width, span: viewSpan, mode, delta: 0 };
                        event.currentTarget.setPointerCapture(event.pointerId);
                        selectTrackLine(segment);
                      }} onPointerMove={event => {
                        const drag = trackDrag.current;
                        if (drag) drag.delta = (event.clientX - drag.x) / drag.width * drag.span;
                      }} onPointerUp={() => void finishTrackDrag()} onPointerCancel={() => { trackDrag.current = null; }}
                      onClick={event => { event.stopPropagation(); selectTrackLine(segment); }}>{segment.text ?? segment.label ?? segment.id}</button>;
                  })}
                  <div className={styles.trackCursor} style={{ left: `${cursorPercent}%` }} />
                </div>
              </div>
              </div>
              </div>
              <p className={styles.panelHint}>显示 {Math.round(viewStart / 1000)}–{Math.round(viewEnd / 1000)} 秒 · 拖动片段平移，拖动左右边缘调整区间；重叠会被拒绝。</p>
              <p className={styles.panelHint}>灰：未编辑 · 红：编辑中 · 绿：已确认完成</p>
              <p className={styles.panelHint}>{videoSize.width} × {videoSize.height} · {Math.round(previewMs)} / {Math.round(durationMs)} ms</p>
              <p className={styles.panelHint} style={{ margin: 0 }}>{segments.length ? `已生成配音 ${segments.length} 句` : '尚未生成配音；使用下方工具条开始'} · 时长 {Math.round(durationMs / 1000)} 秒</p>
            </div>
          </div>
        </div>
        <div className={styles.toolbar} aria-label="台词导入与配音生成工具条">
          <input ref={mediaInput} type="file" accept="video/*,image/*" hidden multiple onChange={event => { for (const file of event.target.files ?? []) void handleImport('media', file); event.target.value = ''; }} />
          <input ref={voiceInput} type="file" accept="audio/*" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void handleImport('voice', file); event.target.value = ''; }} />
          <input ref={scriptInput} type="file" accept=".txt,.md,text/plain" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void handleImport('script', file); event.target.value = ''; }} />
          <button type="button" className={styles.toolBtn} onClick={() => mediaInput.current?.click()}>导入素材</button>
          <button type="button" className={styles.toolBtn} onClick={() => voiceInput.current?.click()}>导入配音</button>
          <button type="button" className={styles.toolBtn} onClick={() => scriptInput.current?.click()}>台词导入</button>
          <button type="button" className={`${styles.toolBtn} ${styles.toolBtnPrimary}`} disabled={!editorNode || generating} onClick={() => void generateVoice()}>{generating ? '生成中…' : '配音初步生成'}</button>
          {generating && <button type="button" className={styles.toolBtn} onClick={() => { generateController.current?.abort(); setToolStatus('已请求停止；已生成音频保留'); }}>停止</button>}
          <span className={styles.toolStatus}>{toolStatus}</span>
        </div>
        <details ref={editorPanel} className={`${styles.panel} ${styles.panelEditor}`} open>
          <summary className={styles.panelHeader}>
            <span className={styles.panelTitle}>多模态编辑区 · 逐句配音</span>
            <span className={styles.panelHint}>点击折叠 / 展开</span>
          </summary>
          <div className={styles.editWorkspace}>
          {editorNode
            ? <div className={styles.editorScroll}><DubbingEditor node={editorNode as never} selected externalVideoRef={previewVideo} selectedLineId={selectedLineId} onLineSelect={setSelectedLineId} onPatch={patch => {
              if (Array.isArray(patch.data?.confirmedLineIds) && selectedLineId && patch.data.confirmedLineIds.includes(selectedLineId)
                && !editorData.confirmedLineIds?.includes(selectedLineId)) setSelectedLineId(null);
              void patchEditorNode(patch);
            }} /></div>
            : <div className={styles.editorEmpty} role="status">{editorError || '正在加载配音编辑卡…'}</div>}
          </div>
        </details>
      </section>
    </div>
  </main>;
}
