import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CardRenderProps } from '@bezier/canvas-card-sdk';
import { demoMediaUrl, demoProjectOf, ensureDubbingListCard, effectiveLineVoice, lineGenerationCurrent, startDemoTts, synthesizeDemoLines } from './demo-adapter';
import { readDramaAudioData, shiftSegmentWindow } from './edl';
import { buildPlaybackPlan, playbackDriftMs, resolvePlaybackDuration } from './playback-plan';
import type { DramaAudioSegment } from './types';
import { VoicePicker } from './voice-picker';

interface RewriteLine {
  id: string;
  text: string;
  videoStartMs: number | null;
  videoEndMs: number | null;
}

/** 试听播放倍速档位：设置 video.playbackRate，配音 WebAudio 排程跟随同一倍率。 */
const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 12, padding: 12, fontSize: 12, color: 'var(--text-primary, #202124)', background: 'var(--bg-app, #fff)' },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  panel: { display: 'flex', flexDirection: 'column', gap: 8, padding: 10, border: '1px solid var(--border-default, #ddd)', borderRadius: 8 },
  input: { width: 90, padding: 4, border: '1px solid var(--border-default, #ddd)', borderRadius: 4, color: 'inherit', background: 'var(--bg-app, #fff)' },
  select: { padding: '4px 6px', border: '1px solid var(--border-default, #ddd)', borderRadius: 5, color: 'inherit', background: 'var(--bg-app, #fff)' },
  button: { padding: '6px 11px', border: '1px solid #93c5fd', borderRadius: 6, background: '#eff6ff', color: '#1e40af', fontWeight: 600, cursor: 'pointer' },
  primaryButton: { padding: '6px 11px', border: '1px solid #1d4ed8', borderRadius: 6, background: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer' },
  successButton: { padding: '6px 11px', border: '1px solid #047857', borderRadius: 6, background: '#059669', color: '#fff', fontWeight: 600, cursor: 'pointer' },
  dangerButton: { padding: '6px 11px', border: '1px solid #fca5a5', borderRadius: 6, background: '#fef2f2', color: '#b91c1c', fontWeight: 600, cursor: 'pointer' },
  hint: { color: 'var(--text-secondary, #666)', lineHeight: 1.6 },
  warning: { color: '#b45309', lineHeight: 1.6 },
  error: { color: '#cf2e2e', lineHeight: 1.6, fontWeight: 600 },
  track: { position: 'relative', height: 46, overflow: 'hidden', borderRadius: 5, background: 'var(--bg-secondary, #f3f4f6)' },
  block: { position: 'absolute', top: 5, height: 36, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', padding: '2px 4px', borderRadius: 4, border: '1px solid #7c5cff', color: 'inherit', background: 'rgba(124,92,255,.15)', cursor: 'grab', touchAction: 'none', userSelect: 'none' },
  collapsedRow: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', minHeight: 24 },
  collapsedText: { flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: 'inherit' },
  badge: { flexShrink: 0, padding: '1px 6px', borderRadius: 999, border: '1px solid var(--border-default, #ddd)', fontSize: 11, lineHeight: 1.5 },
};

function finiteMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function readLines(value: unknown): RewriteLine[] {
  if (!Array.isArray(value)) return [];
  return value.filter((line): line is RewriteLine => !!line && typeof line === 'object'
    && typeof line.id === 'string' && typeof line.text === 'string');
}

function validWindow(start: unknown, end: unknown): boolean {
  return finiteMs(start) && finiteMs(end) && end > start;
}

function excessMs(segment: DramaAudioSegment): number {
  if (!validWindow(segment.videoStartMs, segment.videoEndMs)
    || !validWindow(segment.startMs, segment.endMs) || !finiteMs(segment.gapMs)) return 0;
  return Math.max(0, segment.endMs - segment.startMs - Math.max(0, segment.videoEndMs! - segment.videoStartMs! - segment.gapMs));
}

function NumberField({ label, value, max, onChange }: {
  label: string;
  value: number | null;
  max?: number;
  onChange: (value: number | null) => void;
}) {
  return <label style={styles.row}>{label}<input style={styles.input} type="number" min={0} max={max} step={max === 2 ? 0.05 : 1}
    value={finiteMs(value) ? value : ''} onChange={event => {
      if (!event.target.value) { onChange(null); return; }
      const next = Number(event.target.value);
      if (finiteMs(next) && (max === undefined || next <= max)) onChange(next);
    }} /></label>;
}

export function DubbingEditor({ node, onPatch, listOnly = false }: CardRenderProps & { listOnly?: boolean }) {
  const data = useMemo(() => readDramaAudioData(node), [node.data]);
  const raw = node.data ?? {};
  const project = demoProjectOf(node);
  const lines = readLines(raw.rewriteLines);
  const confirmed = Array.isArray(raw.confirmedLineIds) ? raw.confirmedLineIds.filter((id): id is string => typeof id === 'string') : [];
  const rows = [...lines, ...data.segments.filter(segment => !lines.some(line => line.id === segment.id)).map(segment => ({ id: segment.id, text: segment.label, videoStartMs: segment.videoStartMs, videoEndMs: segment.videoEndMs }))];
  const video = useRef<HTMLVideoElement>(null);
  const context = useRef<AudioContext | null>(null);
  const buffers = useRef(new Map<string, AudioBuffer>());
  const sources = useRef(new Set<{ source: AudioBufferSourceNode; gain: GainNode }>());
  const loadController = useRef<AbortController | null>(null);
  const generationController = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const loaded = useRef(false);
  const clockAnchor = useRef<{ videoMs: number; audioSeconds: number; rate: number } | null>(null);
  const previewEndMs = useRef<number | null>(null);
  const latest = useRef({ data, raw, project, onPatch });
  latest.current = { data, raw, project, onPatch };
  const [originalAudio, setOriginalAudio] = useState(false);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [startingTts, setStartingTts] = useState(false);
  const [loadStatus, setLoadStatus] = useState('尚未载入配音');
  const [generationStatus, setGenerationStatus] = useState('');
  const [error, setError] = useState('');
  const [currentMs, setCurrentMs] = useState(0);
  const [mediaDurationMs, setMediaDurationMs] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showLineList, setShowLineList] = useState(true);
  const lineList = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!expandedId) return;
    setShowLineList(true);
  }, [expandedId]);
  useEffect(() => {
    if (!showLineList || !expandedId) return;
    const row = Array.from(lineList.current?.children ?? []).find(element => (element as HTMLElement).dataset.lineId === expandedId) as HTMLElement | undefined;
    if (row && lineList.current) lineList.current.scrollTop = row.offsetTop - lineList.current.offsetTop;
  }, [expandedId, showLineList]);
  const [rate, setRate] = useState(1);
  const [drag, setDrag] = useState<{
    id: string; pointerId: number; startX: number; trackWidth: number;
    originStartMs: number; originEndMs: number; moved: boolean;
    preview: { videoStartMs: number; videoEndMs: number } | null;
  } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const selectLineRef = useRef(selectLine);
  selectLineRef.current = selectLine;
  useEffect(() => {
    if (!listOnly) return;
    const select = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.project !== project || detail?.nodeId !== node.id || typeof detail.lineId !== 'string') return;
      setShowLineList(true);
      setExpandedId(detail.lineId);
    };
    window.addEventListener('drama-demo-select-line', select);
    return () => window.removeEventListener('drama-demo-select-line', select);
  }, [listOnly, project, node.id]);
  useEffect(() => {
    if (listOnly && typeof raw.selectedDubbingLineId === 'string') {
      setShowLineList(true);
      setExpandedId(raw.selectedDubbingLineId);
    }
  }, [listOnly, raw.selectedDubbingLineId]);
  const seekRef = useRef(seek);
  seekRef.current = seek;
  const editSegmentRef = useRef(editSegment);
  editSegmentRef.current = editSegment;
  const videoDurationMs = resolvePlaybackDuration(data.videoDurationMs, mediaDurationMs);
  let videoUrl: string | undefined;
  try { videoUrl = project && data.videoRef ? demoMediaUrl(project, data.videoRef) : undefined; }
  catch { videoUrl = undefined; }
  const videoDurationMsRef = useRef(videoDurationMs);
  videoDurationMsRef.current = videoDurationMs;

  const stop = useCallback(() => {
    epoch.current += 1;
    clockAnchor.current = null;
    for (const item of sources.current) {
      item.source.onended = null;
      try { item.source.stop(); } catch {}
      item.source.disconnect();
      item.gain.disconnect();
    }
    sources.current.clear();
  }, []);

  const schedule = useCallback(() => {
    stop();
    const element = video.current;
    const audioContext = context.current;
    if (!loaded.current || !element || element.paused || element.ended || element.seeking
      || element.readyState < 3 || !audioContext || audioContext.state !== 'running') return;
    const rate = element.playbackRate;
    if (!Number.isFinite(rate) || rate <= 0) return;
    const at = audioContext.currentTime;
    clockAnchor.current = { videoMs: element.currentTime * 1000, audioSeconds: at, rate };
    try {
      for (const item of buildPlaybackPlan(latest.current.data, element.currentTime * 1000)) {
        const buffer = buffers.current.get(item.audioRef);
        if (!buffer) throw new Error(`配音未载入：${item.audioRef}，请重新载入试听`);
        const offset = item.offsetMs / 1000;
        const duration = Math.min(item.durationMs / 1000, buffer.duration - offset);
        if (duration <= 0) continue;
        const source = audioContext.createBufferSource();
        const gain = audioContext.createGain();
        const active = { source, gain };
        sources.current.add(active);
        source.buffer = buffer;
        source.playbackRate.setValueAtTime(rate, at);
        gain.gain.setValueAtTime(item.gain, at);
        source.connect(gain);
        gain.connect(audioContext.destination);
        source.onended = () => {
          source.disconnect();
          gain.disconnect();
          sources.current.delete(active);
        };
        const when = at + item.delayMs / 1000 / rate;
        source.start(when, offset, duration);
        source.stop(when + duration / rate);
      }
    } catch (reason) {
      stop();
      setError(reason instanceof Error ? reason.message : '配音排程失败');
    }
  }, [stop]);

  const resumeAndSchedule = useCallback(() => {
    const audioContext = context.current;
    if (!audioContext || !loaded.current) return;
    const token = epoch.current;
    void audioContext.resume().then(() => {
      if (epoch.current === token) schedule();
    }).catch(reason => setError(reason instanceof Error ? reason.message : 'WebAudio 无法启用'));
  }, [schedule]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const update = () => setCurrentMs(element.currentTime * 1000);
    const seeking = () => { stop(); update(); };
    const metadata = () => {
      setMediaDurationMs(Number.isFinite(element.duration) ? element.duration * 1000 : 0);
      update();
    };
    const listeners: [string, () => void][] = [
      ['play', resumeAndSchedule], ['playing', resumeAndSchedule], ['pause', stop], ['ended', stop],
      ['seeking', seeking], ['seeked', resumeAndSchedule], ['ratechange', schedule], ['waiting', stop],
      ['timeupdate', update], ['loadedmetadata', metadata], ['durationchange', metadata],
    ];
    let frame = 0;
    let lastResumeAt = -Infinity;
    const tick = () => {
      update();
      if (previewEndMs.current !== null && element.currentTime * 1000 >= previewEndMs.current) {
        previewEndMs.current = null;
        element.pause();
      }
      const audioContext = context.current;
      if (!element.paused && !element.ended && !element.seeking && element.readyState >= 3 && loaded.current && audioContext) {
        const anchor = clockAnchor.current;
        if (audioContext.state === 'running') {
          if (!anchor || anchor.rate !== element.playbackRate
            || Math.abs(playbackDriftMs(anchor.videoMs, anchor.audioSeconds, element.currentTime * 1000, audioContext.currentTime, element.playbackRate)) > 80) schedule();
        } else if (performance.now() - lastResumeAt > 1000) {
          lastResumeAt = performance.now();
          resumeAndSchedule();
        }
      }
      frame = requestAnimationFrame(tick);
    };
    for (const [name, listener] of listeners) element.addEventListener(name, listener);
    if (element.readyState >= 1) metadata();
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      for (const [name, listener] of listeners) element.removeEventListener(name, listener);
      stop();
    };
  }, [videoUrl, resumeAndSchedule, schedule, stop]);

  useEffect(() => {
    if (video.current) { video.current.volume = originalAudio ? 1 : 0; video.current.muted = !originalAudio; }
  }, [originalAudio, videoUrl]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.playbackRate = rate;
  }, [rate, videoUrl]);

  const onBlockPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.currentTarget.dataset.segmentId || !event.currentTarget.dataset.startMs || !event.currentTarget.dataset.endMs) return;
    const track = event.currentTarget.parentElement;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0 || videoDurationMsRef.current <= 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      id: event.currentTarget.dataset.segmentId,
      pointerId: event.pointerId,
      startX: event.clientX,
      trackWidth: rect.width,
      originStartMs: Number(event.currentTarget.dataset.startMs),
      originEndMs: Number(event.currentTarget.dataset.endMs),
      moved: false,
      preview: null,
    });
  }, []);

  const onBlockPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const current = dragRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const deltaMs = (event.clientX - current.startX) / current.trackWidth * videoDurationMsRef.current;
    const preview = shiftSegmentWindow({ videoStartMs: current.originStartMs, videoEndMs: current.originEndMs }, deltaMs, videoDurationMsRef.current);
    if (!preview || preview.videoStartMs === (current.preview?.videoStartMs ?? current.originStartMs)) return;
    setDrag({ ...current, moved: true, preview });
  }, []);

  const onBlockPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const current = dragRef.current;
    if (!current || event.pointerId !== current.pointerId) return;
    setDrag(null);
    if (current.moved && current.preview) {
      selectLineRef.current(current.id);
      editSegmentRef.current(current.id, { videoStartMs: current.preview.videoStartMs, videoEndMs: current.preview.videoEndMs });
    } else {
      selectLineRef.current(current.id);
      seekRef.current(current.originStartMs);
    }
  }, []);

  const decisionKey = JSON.stringify({ segments: data.segments, audioRef: data.audioRef, masterGain: data.masterGain });
  useEffect(() => { schedule(); }, [decisionKey, schedule]);

  useEffect(() => {
    stop();
    loadController.current?.abort();
    generationController.current?.abort();
    loaded.current = false;
    buffers.current.clear();
    setLoadStatus('尚未载入配音');
    setLoading(false);
    setGenerating(false);
    setCurrentMs(0);
    setMediaDurationMs(0);
  }, [project, node.id, videoUrl, stop]);

  useEffect(() => () => {
    stop();
    loadController.current?.abort();
    generationController.current?.abort();
    const audioContext = context.current;
    context.current = null;
    if (audioContext) void audioContext.close().catch(() => {});
  }, [stop]);

  function selectLine(id: string) {
    setExpandedId(id);
    if (listOnly || !project) return;
    window.dispatchEvent(new CustomEvent('drama-demo-select-line', { detail: { project, nodeId: node.id, lineId: id } }));
    void ensureDubbingListCard(project, node.id)
      .then(() => patch({ selectedDubbingLineId: id }))
      .catch(reason => setError(reason instanceof Error ? reason.message : '列表卡创建失败'));
  }

  function patch(changes: Record<string, unknown>) {
    const current = latest.current;
    current.onPatch({ data: { ...current.raw, stage: 'edit', ...changes } });
  }

  function editLineVoice(id: string, value: string | null) {
    const overrides = { ...(latest.current.raw.lineVoiceInstructions as Record<string, string> ?? {}) };
    if (value?.trim()) overrides[id] = value.trim();
    else delete overrides[id];
    patch({ lineVoiceInstructions: overrides });
  }

  function editLineGain(id: string, gain: number) {
    if (!Number.isFinite(gain) || gain < 0 || gain > 2) return;
    patch({ lineGains: { ...(latest.current.raw.lineGains as Record<string, number> ?? {}), [id]: gain },
      segments: latest.current.data.segments.map(segment => segment.id === id ? { ...segment, gain } : segment) });
  }

  function editLine(id: string, text: string) {
    const current = latest.current;
    const rewriteLines = readLines(current.raw.rewriteLines).map(line => line.id === id ? { ...line, text } : line);
    const confirmedLineIds = Array.isArray(current.raw.confirmedLineIds) ? current.raw.confirmedLineIds.filter(value => value !== id) : [];
    patch({ rewriteLines, script: rewriteLines.map(line => line.text).join('\n'),
      segments: current.data.segments.map(segment => segment.id === id ? { ...segment, label: text } : segment), confirmedLineIds });
  }

  function editSegment(id: string, changes: Partial<DramaAudioSegment>) {
    const current = latest.current;
    const timing = 'videoStartMs' in changes || 'videoEndMs' in changes;
    const extra: Record<string, unknown> = timing ? {
      rewriteLines: readLines(current.raw.rewriteLines).map(line => line.id === id ? { ...line,
        ...('videoStartMs' in changes ? { videoStartMs: changes.videoStartMs } : {}),
        ...('videoEndMs' in changes ? { videoEndMs: changes.videoEndMs } : {}) } : line),
      confirmedLineIds: Array.isArray(current.raw.confirmedLineIds) ? current.raw.confirmedLineIds.filter(value => value !== id) : [],
    } : {};
    patch({ ...extra, segments: current.data.segments.map(segment => segment.id === id ? { ...segment, ...changes } : segment) });
  }

  async function loadAudio() {
    if (!project || loading) return;
    stop();
    loaded.current = false;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true);
    setError('');
    setLoadStatus('正在载入各句真实音频…');
    try {
      if (typeof AudioContext === 'undefined') throw new Error('此浏览器不支持 WebAudio，试听不可用');
      const audioContext = context.current ?? new AudioContext();
      context.current = audioContext;
      await audioContext.resume();
      const refs = [...new Set(latest.current.data.segments.map(segment => segment.audioRefOverride ?? latest.current.data.audioRef).filter((ref): ref is string => ref !== null))];
      if (!refs.length) throw new Error('尚无逐句配音，请先生成');
      await Promise.all(refs.map(async ref => {
        if (buffers.current.has(ref)) return;
        const response = await fetch(demoMediaUrl(project, ref), { signal: controller.signal, redirect: 'error' });
        if (!response.ok) throw new Error(`音频读取失败 HTTP ${response.status}：${ref}`);
        const buffer = await audioContext.decodeAudioData(await response.arrayBuffer());
        if (controller.signal.aborted) return;
        buffers.current.set(ref, buffer);
      }));
      if (controller.signal.aborted) return;
      loaded.current = true;
      setLoadStatus(`已载入 ${refs.length} 个音频源；按视频时钟试听，不自动拉伸`);
      schedule();
    } catch (reason) {
      if (!controller.signal.aborted) {
        controller.abort();
        stop();
        setLoadStatus('配音载入失败');
        setError(reason instanceof Error ? reason.message : '配音载入失败');
      }
    } finally {
      if (loadController.current === controller) { loadController.current = null; setLoading(false); }
    }
  }

  async function startTtsService() {
    if (!project || startingTts || generating) return;
    const controller = new AbortController();
    generationController.current = controller;
    setStartingTts(true);
    setError('');
    setGenerationStatus('正在检查并启动本地 TTS…');
    try {
      await startDemoTts(project, node.id, controller.signal);
      setGenerationStatus('本地 TTS 接口已就绪；首次生成将加载模型');
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '本地 TTS 启动失败');
    } finally {
      if (generationController.current === controller) generationController.current = null;
      setStartingTts(false);
    }
  }

  async function generate(onlyLineId?: string) {
    if (!project || generating || startingTts) return;
    const controller = new AbortController();
    generationController.current = controller;
    setGenerating(true);
    setError('');
    setGenerationStatus('正在提交逐句配音…');
    stop();
    loaded.current = false;
    setLoadStatus('生成后请重新载入配音试听');
    try {
      await ensureDubbingListCard(project, node.id, controller.signal);
      await synthesizeDemoLines(project, node.id, controller.signal, message => {
        if (!controller.signal.aborted) setGenerationStatus(message);
      }, onlyLineId);
    } catch (reason) {
      if (!controller.signal.aborted) {
        const message = reason instanceof Error ? reason.message : '逐句生成失败；不自动重试';
        setError(message);
        patch({ ttsStatus: message, ttsActiveLineId: null });
      }
    } finally {
      if (generationController.current === controller) { generationController.current = null; setGenerating(false); }
    }
  }

  useEffect(() => {
    if (listOnly) return;
    const listener = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.project !== project || detail?.nodeId !== node.id) return;
      if (detail.play) void playPreview(detail.start, detail.end);
      else seek(detail.start);
    };
    window.addEventListener('drama-demo-preview', listener);
    return () => window.removeEventListener('drama-demo-preview', listener);
  }, [project, node.id, listOnly]);

  function seek(ms: number | null) {
    if (listOnly) {
      window.dispatchEvent(new CustomEvent('drama-demo-preview', { detail: { project, nodeId: node.id, start: ms } }));
      return;
    }
    if (!video.current || !finiteMs(ms)) return;
    previewEndMs.current = null;
    stop();
    const target = Math.min(ms, videoDurationMs || ms) / 1000;
    if (Math.abs(video.current.currentTime - target) < 0.001) {
      resumeAndSchedule();
    } else {
      video.current.currentTime = target;
    }
    setCurrentMs(video.current.currentTime * 1000);
  }

  async function playPreview(startMs?: number | null, endMs?: number | null) {
    if (listOnly) {
      window.dispatchEvent(new CustomEvent('drama-demo-preview', { detail: { project, nodeId: node.id, start: startMs, end: endMs, play: true } }));
      return;
    }
    const element = video.current;
    if (!element) return;
    if (!loaded.current && latest.current.data.segments.length) {
      await loadAudio();
      if (!loaded.current) return;
    }
    if (finiteMs(startMs)) seek(startMs);
    previewEndMs.current = finiteMs(endMs) ? endMs : null;
    try { await element.play(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '视频无法播放'); }
  }

  function seekTrack(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width > 0) seek(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * videoDurationMs);
  }

  function blockStyle(start: number | null, end: number | null): React.CSSProperties | null {
    if (!validWindow(start, end) || videoDurationMs <= 0 || start! >= videoDurationMs) return null;
    return { ...styles.block, left: `${start! / videoDurationMs * 100}%`, width: `${(Math.min(end!, videoDurationMs) - start!) / videoDurationMs * 100}%` };
  }

  return <section className="nodrag nopan" style={styles.root} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    {!listOnly && <>
    <strong>逐句配音编辑</strong>
    <div style={styles.hint}>视频是唯一主时钟。自动建议尚待逐句确认；静音不压缩视频，停顿保留在视频区间尾部。</div>
    {!project && <div style={styles.warning}>本地 demo 项目不可用；不会回退或模拟生成成功。</div>}
    {videoUrl ? <video ref={video} src={videoUrl} controls muted={!originalAudio} preload="metadata" style={{ width: '100%', maxHeight: 260, background: '#000', borderRadius: 6 }}
      onError={() => { stop(); setError('视频读取失败，无法同步试听'); }} /> : <div style={styles.warning}>未绑定有效视频工程文件</div>}
    <div style={styles.row}>
      <label><input type="checkbox" checked={originalAudio} onChange={event => setOriginalAudio(event.target.checked)} />播放视频原声（默认关闭）</label>
      <NumberField label="总音量 0..2" value={data.masterGain} max={2} onChange={value => { if (value !== null) patch({ masterGain: value }); }} />
      <label style={styles.row}>倍速
        <select style={styles.select} value={rate} onChange={event => setRate(Number(event.target.value))}>
          {PLAYBACK_RATES.map(value => <option key={value} value={value}>{value}x</option>)}
        </select>
      </label>
      <span>{Math.round(currentMs)} / {Math.round(videoDurationMs)} ms</span>
    </div>
    <VoicePicker value={data.voiceInstruction} styles={styles} onChange={next => patch({ voiceInstruction: next })} />
    <div style={styles.row}>
      <button style={styles.button} disabled={!project || startingTts || generating} onClick={() => void startTtsService()}>{startingTts ? 'TTS 启动中…' : '启动 / 检查本地 TTS'}</button>
      <button style={{ ...styles.primaryButton, opacity: !project || !rows.length || generating || loading || startingTts ? 0.45 : 1 }} disabled={!project || !rows.length || generating || loading || startingTts} onClick={() => void generate()}>逐句生成配音</button>
      {generating && <button style={styles.dangerButton} onClick={() => { generationController.current?.abort(); setGenerationStatus('已请求停止；已有音频保留，未完成结果不自动重试'); }}>停止生成</button>}
      <button style={styles.button} disabled={!project || !videoUrl || loading || generating} onClick={() => void loadAudio()}>载入配音试听</button>
      <button style={styles.successButton} disabled={!videoUrl || loading || generating} onClick={() => void playPreview()}>同步播放</button>
      <button style={styles.button} disabled={!videoUrl} onClick={() => { previewEndMs.current = null; video.current?.pause(); }}>暂停</button>
    </div>
    <input aria-label="视频与配音统一播放位置" type="range" min={0} max={Math.max(1, videoDurationMs)} step={1} value={Math.min(currentMs, videoDurationMs)}
      style={{ width: '100%', accentColor: '#2563eb' }} onChange={event => seek(Number(event.target.value))} />
    {mediaDurationMs > 0 && Math.abs(mediaDurationMs - data.videoDurationMs) > 50 && <div style={styles.warning}>已按视频实际时长同步时间轴；保存时长与媒体不同，配音区间仍需人工核对。</div>}
    <div role="status" style={styles.hint}>{loadStatus}{generationStatus && <div>{generationStatus}</div>}</div>
    {error && <div role="alert" style={styles.error}>{error}</div>}
    <div style={styles.panel}>
      <div style={styles.row}><strong>统一视频时间轴</strong><span style={styles.hint}>0 — {Math.round(videoDurationMs)} ms；上下轨共用比例，点击台词定位</span></div>
      <div>视频画面 / 原声（{originalAudio ? '原声开启' : '原声关闭'}）</div>
      <div style={styles.track} onClick={seekTrack}>
        <div style={{ position: 'absolute', inset: 5, borderRadius: 4, background: '#dcfce7', color: '#166534', padding: '4px 8px', pointerEvents: 'none' }}>原视频 · {Math.round(videoDurationMs / 1000)} 秒</div>
        {data.captions.map(caption => {
        const style = blockStyle(caption.startMs, caption.endMs);
        return style && <button key={caption.id} style={style} title={caption.text} onClick={() => seek(caption.startMs)}>{caption.text}</button>;
      })}<div style={{ position: 'absolute', left: `${videoDurationMs > 0 ? Math.min(100, currentMs / videoDurationMs * 100) : 0}%`, top: 0, bottom: 0, width: 2, background: '#dc2626', pointerEvents: 'none' }} /></div>
      <div>逐句配音（可拖拽调前后位置，保持时长；点击选中展开）</div>
      <div style={styles.track} onClick={seekTrack}>{rows.map(line => {
        const segment = data.segments.find(item => item.id === line.id);
        const start = segment ? segment.videoStartMs : line.videoStartMs;
        const end = segment ? segment.videoEndMs : line.videoEndMs;
        const dragging = drag?.id === line.id && drag.preview;
        const style = blockStyle(dragging ? drag.preview!.videoStartMs : start, dragging ? drag.preview!.videoEndMs : end);
        if (!style) return null;
        return <div key={line.id} role="button" tabIndex={0} data-segment-id={line.id} data-start-ms={start ?? undefined} data-end-ms={end ?? undefined}
          style={{ ...style, borderColor: drag?.id === line.id ? '#cf2e2e' : segment && excessMs(segment) > 0 ? '#cf2e2e' : '#0c87fa', background: segment?.muted ? '#ddd' : 'rgba(12,135,250,.15)', zIndex: drag?.id === line.id ? 2 : undefined, opacity: drag?.id === line.id ? 0.9 : 1 }}
          title={`${line.text}；${confirmed.includes(line.id) ? '已人工确认' : '自动建议尚待确认'}；拖拽整体平移（保持时长），点击定位视频`}
          onPointerDown={onBlockPointerDown} onPointerMove={onBlockPointerMove} onPointerUp={onBlockPointerUp}
          onPointerCancel={() => setDrag(null)} onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectLine(line.id); seek(start); }
          }}>{line.text}{segment?.muted ? '（静音）' : ''}{dragging ? '（拖拽中）' : ''}</div>;
      })}<div style={{ position: 'absolute', left: `${videoDurationMs > 0 ? Math.min(100, currentMs / videoDurationMs * 100) : 0}%`, top: 0, bottom: 0, width: 2, background: '#dc2626', pointerEvents: 'none' }} /></div>
    </div>
    </>}
    {!listOnly && <button style={styles.button} disabled={!project} onClick={() => {
      if (!project) return;
      void ensureDubbingListCard(project, node.id).catch(reason => setError(reason instanceof Error ? reason.message : '列表卡创建失败'));
    }}>显示配音句列表卡</button>}
    {listOnly && <>
    <strong>配音句列表与细节编辑</strong>
    <div role="status" style={styles.hint}>{typeof raw.ttsStatus === 'string' ? raw.ttsStatus : '等待逐句生成'}{generationStatus && ` · ${generationStatus}`}</div>
    {error && <div role="alert" style={styles.error}>{error}</div>}
    <div style={styles.row}>
      <strong>配音句列表 · {rows.length} 句</strong>
      <button style={styles.button} aria-expanded={showLineList} onClick={() => setShowLineList(value => !value)}>{showLineList ? '收起配音列表' : '展开配音列表'}</button>
      <button style={styles.button} disabled={!expandedId} onClick={() => setExpandedId(null)}>收起句子编辑</button>
    </div>
    {showLineList && <div ref={lineList} role="region" aria-label="配音句滚动列表" tabIndex={0}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 340, overflowY: 'auto', overscrollBehavior: 'contain', padding: 2, scrollbarGutter: 'stable' }}
      onWheel={event => event.stopPropagation()}>
    {rows.map((line, index) => {
      const segment = data.segments.find(item => item.id === line.id);
      const start = segment ? segment.videoStartMs : line.videoStartMs;
      const end = segment ? segment.videoEndMs : line.videoEndMs;
      const over = segment ? excessMs(segment) : 0;
      const stale = !!segment && !lineGenerationCurrent(raw, line.id, line.text);
      const lineVoice = (raw.lineVoiceInstructions as Record<string, string> | undefined)?.[line.id] ?? null;
      const lineGain = segment?.gain ?? (raw.lineGains as Record<string, number> | undefined)?.[line.id] ?? 1;
      const buffer = segment ? buffers.current.get(segment.audioRefOverride ?? data.audioRef ?? '') : undefined;
      const expanded = expandedId === line.id;
      const badge = raw.ttsActiveLineId === line.id ? '生成中' : drag?.id === line.id && drag.moved ? '拖拽中' : segment?.muted ? '静音' : stale ? '配音过期' : !segment ? '未生成' : confirmed.includes(line.id) ? '已确认' : '待确认';
      return <div key={line.id} data-line-id={line.id} style={{ ...styles.panel, flexShrink: 0 }}>
        <div style={styles.collapsedRow} onClick={() => setExpandedId(expanded ? null : line.id)} role="button" tabIndex={0}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setExpandedId(expanded ? null : line.id); } }}>
          <strong>第 {index + 1} 句</strong>
          <span style={styles.collapsedText} title={line.text}>{line.text}</span>
          <span style={styles.badge}>{badge}</span>
          <span style={styles.hint}>{validWindow(start, end) ? `${Math.round(start!)}–${Math.round(end!)}ms` : '未对齐'}</span>
          <span style={styles.hint}>{expanded ? '收起 ▲' : '展开 ▼'}</span>
        </div>
        {expanded && <>
        <div style={styles.row}><strong>{line.id}</strong><span style={styles.hint}>{confirmed.includes(line.id) ? '已人工确认视频区间' : '自动建议尚待确认'}</span>
          <button style={styles.button} disabled={!validWindow(start, end)} onClick={() => seek(start)}>定位视频</button>
          <button style={styles.primaryButton} disabled={!segment || !validWindow(start, end) || loading || generating} onClick={() => void playPreview(start, end)}>本句同步试听</button>
          <button style={styles.successButton} disabled={!validWindow(start, end) || confirmed.includes(line.id)} onClick={() => {
            const ids = latest.current.raw.confirmedLineIds;
            patch({ confirmedLineIds: [...new Set([...(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []), line.id])] });
          }}>确认本句区间</button>
        </div>
        <label>台词标签<textarea value={line.text} style={{ ...styles.input, display: 'block', width: '100%', boxSizing: 'border-box', minHeight: 52 }}
          onChange={event => editLine(line.id, event.target.value)} /></label>
        <VoicePicker value={lineVoice} label="本句音色" defaultLabel="继承整体音色" defaultHint={`当前生效：${effectiveLineVoice(raw, line.id)}`}
          styles={styles} onChange={value => editLineVoice(line.id, value)} />
        <div style={styles.row}>
          <NumberField label="本句音量 0..2" value={lineGain} max={2} onChange={value => { if (value !== null) editLineGain(line.id, value); }} />
          <span style={styles.hint}>试听音量 = 总音量 × 本句音量；改音量无需重新生成</span>
          <button style={styles.primaryButton} disabled={generating || startingTts || loading || !project} onClick={() => void generate(line.id)}>生成本句配音</button>
        </div>
        {stale && <div style={styles.warning}>文字或音色与生成记录不一致，旧音频未变化；请生成本句配音。</div>}
        {!segment && <div style={styles.hint}>本句尚未生成真实音频。</div>}
        <div style={styles.row}>
          <NumberField label="视频 startMs" value={start} onChange={value => editSegment(line.id, { videoStartMs: value })} />
          <NumberField label="视频 endMs" value={end} onChange={value => editSegment(line.id, { videoEndMs: value })} />
        </div>
        {segment && <>
          <div style={styles.row}>
            <NumberField label="源截取 startMs" value={segment.startMs} onChange={value => { if (value !== null) editSegment(line.id, { startMs: value }); }} />
            <NumberField label="源截取 endMs" value={segment.endMs} onChange={value => { if (value !== null) editSegment(line.id, { endMs: value }); }} />
            <NumberField label="段后 gapMs" value={segment.gapMs} onChange={value => { if (value !== null) editSegment(line.id, { gapMs: value }); }} />
            <label><input type="checkbox" checked={segment.muted} onChange={event => editSegment(line.id, { muted: event.target.checked })} />muted（保留视频时钟）</label>
          </div>
          <div style={{ ...styles.hint, overflowWrap: 'anywhere' }}>音频源：{segment.audioRefOverride ?? data.audioRef ?? '未绑定'}</div>
          {!validWindow(start, end) && <div style={styles.warning}>视频区间未对齐或非法，本句不播放。</div>}
          {!validWindow(segment.startMs, segment.endMs) && <div style={styles.error}>源截取区间非法，本句不播放。</div>}
          {over > 0 && <div style={styles.error}>时长超限 {Math.ceil(over)} ms：试听会截断超出视频允许区间的音频，不自动拉伸，未宣称对齐。</div>}
          {finiteMs(end) && videoDurationMs > 0 && end > videoDurationMs && <div style={styles.error}>视频区间超过视频总时长，请调整。</div>}
          {buffer && segment.endMs > buffer.duration * 1000 + 1 && <div style={styles.error}>源截取超过真实音频时长 {Math.round(buffer.duration * 1000)} ms；试听仅播放实际存在的音频。</div>}
        </>}
        </>}
      </div>;
    })}
    </div>}
    </>}
  </section>;
}
