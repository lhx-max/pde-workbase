import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CardRenderProps } from '@bezier/canvas-card-sdk';
import { adoptDubbingCandidate, candidateMatches, dubbingCounts, effectiveLineVoice, lineGenerationCurrent, voiceInstructionOf, voiceReferenceOf, type DubbingCandidate } from './dubbing';
import { checkLocalVoice, fillMissing, generateCandidate, localVoiceAvailable } from './director/local-voice';
import { requireMedia, type MediaLookup } from './director/media';
import { readDramaAudioData, shiftSegmentWindow } from './edl';
import { buildDirectorPlaybackPlan, gainAt, gainRegionsOf, originalGainOf, playbackDriftMs, resolvePlaybackDuration, scheduleMixGain, segmentRate, type AudioListenMode } from './playback-plan';
import { stretchBuffer } from './director/time-stretch';
import { insertRewriteLine, validateRewriteLines, type RewriteLine as TimedRewriteLine } from './rewrite';
import type { DramaAudioData, DramaAudioSegment } from './types';
import { VoicePicker, voiceName } from './voice-picker';

interface RewriteLine {
  id: string;
  text: string;
  videoStartMs: number | null;
  videoEndMs: number | null;
}

/** 试听播放倍速档位：设置 video.playbackRate，配音 WebAudio 排程跟随同一倍率。 */
export type PlaybackRange = { startMs: number; endMs: number };
export type DubbingPlayback = {
  play: (ranges?: PlaybackRange[], loop?: boolean, preview?: Pick<DramaAudioData, 'segments' | 'audioRef' | 'masterGain'>) => Promise<void>;
  stop: () => void;
  seek: (ms: number) => void;
};

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];
/** 每次排程覆盖的时间轴范围；超出部分在播放推进时续排。 */
const SCHEDULE_HORIZON_MS = 30_000;

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 12, padding: 12, fontSize: 12, color: 'var(--text-primary, #202124)', background: 'var(--bg-app, #fff)' },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  panel: { display: 'flex', flexDirection: 'column', gap: 8, padding: 10, border: '1px solid var(--border-default, #ddd)', borderRadius: 8 },
  input: { width: 90, padding: 4, border: '1px solid var(--border-default, #ddd)', borderRadius: 4, color: 'inherit', background: 'var(--bg-app, #fff)' },
  select: { padding: '4px 6px', border: '1px solid var(--border-default, #ddd)', borderRadius: 5, color: 'inherit', background: 'var(--bg-app, #fff)' },
  button: { padding: '6px 11px', border: '1px solid var(--director-button-border, #93c5fd)', borderRadius: 6, background: 'var(--director-button-bg, #eff6ff)', color: 'var(--director-button-text, #1e40af)', fontWeight: 600, cursor: 'pointer' },
  primaryButton: { padding: '6px 11px', border: '1px solid var(--director-primary-bg, #1d4ed8)', borderRadius: 6, background: 'var(--director-primary-bg, #2563eb)', color: '#fff', fontWeight: 600, cursor: 'pointer' },
  successButton: { padding: '6px 11px', border: '1px solid var(--director-confirm-bg, #047857)', borderRadius: 6, background: 'var(--director-confirm-bg, #059669)', color: '#fff', fontWeight: 600, cursor: 'pointer' },
  dangerButton: { padding: '6px 11px', border: '1px solid #fca5a5', borderRadius: 6, background: '#fef2f2', color: '#b91c1c', fontWeight: 600, cursor: 'pointer' },
  hint: { color: 'var(--text-secondary, #666)', lineHeight: 1.6 },
  warning: { color: 'var(--director-warning, #b45309)', lineHeight: 1.6 },
  error: { color: 'var(--director-error, #cf2e2e)', lineHeight: 1.6, fontWeight: 600 },
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
  // 按实际倍率（手动语速 × 贴合加速）换算成时间轴时长；leadMs 是提前进入的重叠部分。
  return Math.max(0, (segment.endMs - segment.startMs) / segmentRate(segment) - Math.max(0, segment.videoEndMs! - segment.videoStartMs! + (segment.leadMs ?? 0) - segment.gapMs));
}

function NumberField({ label, value, max, onChange }: {
  label: string;
  value: number | null;
  max?: number;
  onChange: (value: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return <label style={styles.row}>{label}<input style={styles.input} type="number" min={0} max={max} step={max === 2 ? 0.05 : 1}
    value={draft ?? (finiteMs(value) ? String(value) : '')}
    onChange={event => setDraft(event.target.value)}
    onBlur={() => {
      if (draft === null) return;
      setDraft(null);
      const next = draft === '' ? null : Number(draft);
      if (next === null || (finiteMs(next) && (max === undefined ? Number.isInteger(next) : next <= max))) onChange(next);
    }}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>;
}

export function DubbingEditor({ node, onPatch, listOnly = false, externalVideoRef, selectedLineId, onLineSelect, sessionMedia, beforeGenerate, onGenerationChange, batchGenerating = false, onOriginalAudio, playback, listenMode, guardPatch }: CardRenderProps & {
  listOnly?: boolean;
  externalVideoRef?: React.RefObject<HTMLVideoElement>;
  selectedLineId?: string | null;
  onLineSelect?: (id: string | null) => void;
  sessionMedia: {
    resolve: MediaLookup;
    add: (file: File) => Promise<string>;
    readData: () => Record<string, unknown>;
  };
  beforeGenerate?: () => Promise<boolean>;
  onGenerationChange?: (generating: boolean) => void;
  batchGenerating?: boolean;
  onOriginalAudio?: (enabled: boolean) => void;
  playback?: React.MutableRefObject<DubbingPlayback | null>;
  listenMode?: AudioListenMode;
  guardPatch?: (data: Record<string, unknown>) => void;
}) {
  const data = useMemo(() => readDramaAudioData(node), [node.data]);
  const raw = node.data ?? {};
  const reference = voiceReferenceOf(raw);
  const canGenerate = localVoiceAvailable();
  const lines = readLines(raw.rewriteLines);
  const confirmed = Array.isArray(raw.confirmedLineIds) ? raw.confirmedLineIds.filter((id): id is string => typeof id === 'string') : [];
  const rows = [...lines, ...data.segments.filter(segment => !lines.some(line => line.id === segment.id)).map(segment => ({ id: segment.id, text: segment.label, videoStartMs: segment.videoStartMs, videoEndMs: segment.videoEndMs }))];
  const internalVideo = useRef<HTMLVideoElement>(null);
  const video = externalVideoRef ?? internalVideo;
  const context = useRef<AudioContext | null>(null);
  const buffers = useRef(new Map<string, AudioBuffer>());
  /** 保持音调变速后的音频，按「音源@倍率」缓存。 */
  const stretched = useRef(new Map<string, AudioBuffer>());
  const sources = useRef(new Set<{ source: AudioBufferSourceNode; gain: GainNode }>());
  const loadController = useRef<AbortController | null>(null);
  const generationController = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const loaded = useRef(false);
  const clockAnchor = useRef<{ videoMs: number; audioSeconds: number; rate: number; horizonMs: number } | null>(null);
  const previewEndMs = useRef<number | null>(null);
  const previewData = useRef<Pick<DramaAudioData, 'segments' | 'audioRef' | 'masterGain'> | null>(null);
  const queue = useRef<{ ranges: PlaybackRange[]; index: number; loop: boolean } | null>(null);
  const playRequest = useRef(0);
  const preparePlayback = useRef<() => void>(() => {});
  const [candidate, setCandidate] = useState<DubbingCandidate | null>(null);
  const counts = dubbingCounts(raw);
  const latest = useRef({ data, raw, onPatch, guardPatch, listenMode });
  latest.current = { data, raw, onPatch, guardPatch, listenMode };
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
  const undoChange = useRef<{ before: Record<string, unknown>; after: string } | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  useEffect(() => {
    if (selectedLineId === undefined) return;
    setExpandedId(selectedLineId);
    if (selectedLineId) setShowLineList(true);
  }, [selectedLineId]);
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
  try {
    if (data.videoRef) videoUrl = sessionMedia.resolve(data.videoRef);
  }
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
    if (latest.current.listenMode === 'original' || !loaded.current || !element || element.paused || element.ended || element.seeking
      || element.readyState < 3 || !audioContext || audioContext.state !== 'running') return;
    const rate = element.playbackRate;
    if (!Number.isFinite(rate) || rate <= 0) return;
    const at = audioContext.currentTime;
    clockAnchor.current = { videoMs: element.currentTime * 1000, audioSeconds: at, rate, horizonMs: element.currentTime * 1000 + SCHEDULE_HORIZON_MS };
    try {
      const currentMs = element.currentTime * 1000;
      const current = latest.current;
      const mix = { ...current.raw, ...(previewData.current ?? current.data) };
      const regions = { voice: gainRegionsOf(mix, 'voice'), background: gainRegionsOf(mix, 'background') };
      const timelineMs = resolvePlaybackDuration(current.data.videoDurationMs, element.duration * 1000);
      for (const item of buildDirectorPlaybackPlan(mix, currentMs, timelineMs, current.listenMode ?? 'voice')) {
        const startMs = currentMs + item.delayMs;
        const availableMs = (previewEndMs.current ?? Infinity) - startMs;
        if (availableMs <= 0) continue;
        // 只排近一段时间的片段，变速伸缩按需计算；播放推进时同步循环会续排。
        if (item.delayMs > SCHEDULE_HORIZON_MS) continue;
        const original = buffers.current.get(item.audioRef);
        if (!original) continue;
        // 保持音调：句子语速和试听倍速都通过时间伸缩实现，播放时不改 playbackRate。
        const factor = Math.round(item.rate * rate * 1000) / 1000;
        const key = `${item.audioRef}@${factor}`;
        let buffer = original;
        if (factor !== 1) {
          buffer = stretched.current.get(key) ?? stretchBuffer(audioContext, original, factor);
          stretched.current.set(key, buffer);
        }
        const offset = item.offsetMs / 1000 / factor;
        const duration = Math.min(item.durationMs / rate / 1000, availableMs / rate / 1000, buffer.duration - offset);
        if (duration <= 0) continue;
        const source = audioContext.createBufferSource();
        const gain = audioContext.createGain();
        const active = { source, gain };
        sources.current.add(active);
        source.buffer = buffer;
        source.connect(gain);
        gain.connect(audioContext.destination);
        source.onended = () => {
          source.disconnect();
          gain.disconnect();
          sources.current.delete(active);
        };
        const when = at + item.delayMs / 1000 / rate;
        scheduleMixGain(gain.gain, regions[item.track], item.gain, startMs, startMs + duration * 1000 * rate, when, rate);
        source.start(when, offset, duration);
        source.stop(when + duration);
      }
    } catch (reason) {
      stop();
      setError(reason instanceof Error ? reason.message : '配音排程失败');
    }
  }, [stop]);

  const resumeAndSchedule = useCallback(() => {
    if (video.current && !video.current.paused) preparePlayback.current();
    const audioContext = context.current;
    if (!audioContext || !loaded.current) return;
    const token = epoch.current;
    void audioContext.resume().then(() => {
      if (epoch.current === token) schedule();
    }).catch(reason => setError(reason instanceof Error ? reason.message : 'WebAudio 无法启用'));
  }, [schedule, video]);

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
      if (latest.current.listenMode && !element.muted) {
        const mix = latest.current.raw;
        element.volume = originalGainOf(mix) * gainAt(gainRegionsOf(mix, 'original'), element.currentTime * 1000);
      }
      if (previewEndMs.current !== null && (element.ended || element.currentTime * 1000 >= previewEndMs.current - 0.5)) {
        const active = queue.current;
        const next = active ? active.ranges[active.index + 1] ?? (active.loop ? active.ranges[0] : undefined) : undefined;
        if (active && next) {
          active.index = (active.index + 1) % active.ranges.length;
          previewEndMs.current = next.endMs;
          element.currentTime = next.startMs / 1000;
          if (element.paused) void element.play().catch(() => setError('无法继续试听选区'));
        } else {
          queue.current = null;
          previewEndMs.current = null;
          previewData.current = null;
          element.pause();
        }
      }
      const audioContext = context.current;
      if (!element.paused && !element.ended && !element.seeking && element.readyState >= 3 && loaded.current && audioContext) {
        const anchor = clockAnchor.current;
        if (audioContext.state === 'running') {
          if (!anchor || anchor.rate !== element.playbackRate || element.currentTime * 1000 > anchor.horizonMs - SCHEDULE_HORIZON_MS / 3
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
    const enabled = listenMode ? listenMode === 'mix' || listenMode === 'original' : originalAudio;
    if (video.current) {
      video.current.volume = enabled ? originalGainOf(latest.current.raw) : 0;
      video.current.muted = !enabled;
    }
    onOriginalAudio?.(enabled);
  }, [originalAudio, videoUrl, onOriginalAudio, listenMode]);

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

  const decisionKey = JSON.stringify({ segments: data.segments, audioRef: data.audioRef, masterGain: data.masterGain, regions: raw.directorGainRegions, background: [raw.directorBackgroundRef, raw.directorBackgroundGain, raw.directorBackgroundDurationMs], listenMode });
  useEffect(() => {
    schedule();
    if (video.current && !video.current.paused) preparePlayback.current();
  }, [decisionKey, schedule, video]);

  useEffect(() => {
    stop();
    loadController.current?.abort();
    generationController.current?.abort();
    loaded.current = false;
    buffers.current.clear();
    previewData.current = null;
    previewEndMs.current = null;
    queue.current = null;
    playRequest.current++;
    setCandidate(null);
    setLoadStatus('尚未载入配音');
    setLoading(false);
    setGenerating(false);
    setCurrentMs(0);
    setMediaDurationMs(0);
  }, [node.id, videoUrl, stop]);

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
    onLineSelect?.(id);
  }

  function patch(changes: Record<string, unknown>) {
    const current = latest.current;
    const next = { ...sessionMedia.readData(), stage: 'edit', ...changes };
    try {
      current.guardPatch?.(next);
      current.onPatch({ data: next });
    }
    catch (reason) {
      setError(reason instanceof Error ? reason.message : '编辑未应用');
      return false;
    }
    return true;
  }

  function changeLineStructure(id: string, action: 'before' | 'after' | 'delete') {
    if (generating || startingTts) return;
    const current = latest.current;
    try {
      const original = readLines(current.raw.rewriteLines) as TimedRewriteLine[];
      if (action === 'delete' && !window.confirm('删除本句及时间轴片段？原音频文件保留，可撤销本次删除。')) return;
      const addedId = `line-${crypto.randomUUID()}`;
      const nextLines = action === 'delete' ? original.filter(line => line.id !== id) : insertRewriteLine(original, id, action, addedId, videoDurationMs);
      const nextSegments = current.data.segments.filter(segment => action !== 'delete' || segment.id !== id).map(segment => {
        const line = nextLines.find(item => item.id === segment.id);
        return line ? { ...segment, videoStartMs: line.videoStartMs, videoEndMs: line.videoEndMs } : segment;
      });
      const next = { ...current.raw, rewriteLines: nextLines, script: nextLines.map(line => line.text).join('\n'), segments: nextSegments,
        confirmedLineIds: confirmed.filter(value => value !== id), selectedDubbingLineId: null };
      current.guardPatch?.(next);
      undoChange.current = { before: structuredClone(current.raw), after: JSON.stringify(next) };
      setCanUndo(true);
      current.onPatch({ data: next });
      const selected = action === 'delete' ? nextLines[0]?.id ?? null : addedId;
      setExpandedId(selected);
      onLineSelect?.(selected);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '句子编辑失败'); }
  }

  function undoStructure() {
    const change = undoChange.current;
    if (!change) return;
    if (JSON.stringify(latest.current.raw) !== change.after) { setError('数据已变化，不能覆盖后续编辑，请先读回'); return; }
    try { latest.current.guardPatch?.(change.before); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '编辑未应用'); return; }
    latest.current.onPatch({ data: change.before });
    undoChange.current = null;
    setCanUndo(false);
    setExpandedId(null);
    onLineSelect?.(null);
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
    if (timing) {
      try {
        const lines = readLines(extra.rewriteLines) as TimedRewriteLine[];
        validateRewriteLines(lines, videoDurationMs);
      } catch (reason) { setError(reason instanceof Error ? reason.message : '区间冲突'); return; }
    }
    patch({ ...extra, segments: current.data.segments.map(segment => segment.id === id ? { ...segment, ...changes } : segment) });
  }

  function planFor(planData: Pick<DramaAudioData, 'segments' | 'audioRef' | 'masterGain'>, at: number, currentMode = latest.current.listenMode ?? 'voice') {
    const current = latest.current;
    const duration = resolvePlaybackDuration(current.data.videoDurationMs, (video.current?.duration ?? 0) * 1000);
    return buildDirectorPlaybackPlan({ ...current.raw, ...planData }, at, duration, currentMode);
  }

  async function loadAudio(planData = latest.current.data as Pick<DramaAudioData, 'segments' | 'audioRef' | 'masterGain'>, mode = latest.current.listenMode ?? 'voice', at = 0) {
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
      const refs = [...new Set(planFor(planData, at, mode).map(item => item.audioRef))];
      if (!refs.length) throw new Error('尚无逐句配音，请先生成');
      // 刷新后未恢复的音频在试听时跳过，不让整段试听失败。
      const missing = refs.filter(ref => !buffers.current.has(ref) && !sessionMedia.resolve(ref));
      if (missing.length === refs.length) throw new Error(`这里的 ${missing.length} 段配音音频都未载入。可以在台词列表上方重新生成，或在「导入与替换素材」里恢复会话素材。`);
      await Promise.all(refs.filter(ref => !missing.includes(ref)).map(async ref => {
        if (buffers.current.has(ref)) return;
        const url = requireMedia(sessionMedia.resolve, ref);
        const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
        if (!response.ok) throw new Error(`音频读取失败 HTTP ${response.status}：${ref}`);
        const buffer = await audioContext.decodeAudioData(await response.arrayBuffer());
        if (controller.signal.aborted) return;
        buffers.current.set(ref, buffer);
      }));
      if (controller.signal.aborted) return;
      loaded.current = true;
      setLoadStatus(`已载入 ${refs.length - missing.length} 个音频源；按视频时钟试听，变速时保持音调`);
      if (missing.length) setGenerationStatus(`${missing.length} 段配音音频未载入，试听时已跳过。可在台词列表上方重新生成。`);
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

  preparePlayback.current = () => {
    if (!video.current || loadController.current) return;
    const current = latest.current;
    const at = video.current.currentTime * 1000;
    const mix = previewData.current ?? current.data;
    const plan = planFor(mix, at);
    // 只为当前会话能读取的音频重新载入，未载入的音频跳过，避免反复失败。
    if (plan.some(item => !buffers.current.has(item.audioRef) && sessionMedia.resolve(item.audioRef))) void loadAudio(mix, current.listenMode, at);
  };

  async function startTtsService() {
    if (!canGenerate || startingTts || generating || batchGenerating) return;
    const controller = new AbortController();
    generationController.current = controller;
    setStartingTts(true);
    setError('');
    setGenerationStatus('正在检查本地 TTS…');
    try {
      await checkLocalVoice(controller.signal);
      setGenerationStatus('本地 TTS 接口已就绪；首次生成将加载模型');
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '本地 TTS 启动失败');
    } finally {
      if (generationController.current === controller) generationController.current = null;
      setStartingTts(false);
    }
  }

  async function generate(onlyLineId?: string) {
    if (!canGenerate || generationController.current || batchGenerating) return;
    const controller = new AbortController();
    generationController.current = controller;
    setGenerating(true);
    onGenerationChange?.(true);
    setError('');
    setGenerationStatus(onlyLineId ? '正在生成新配音…' : '正在补齐缺失配音…');
    try {
      if (beforeGenerate && !await beforeGenerate()) throw new Error('请先解决草稿保存问题');
      if (onlyLineId) {
        const result = await generateCandidate(sessionMedia.readData, sessionMedia.add, onlyLineId, controller.signal, sessionMedia.resolve);
        setCandidate(result);
        setGenerationStatus('新配音已生成，先试听，满意就点「用这条」。');
      } else {
        const progress = (message: string) => {
          if (!controller.signal.aborted) setGenerationStatus(message);
        };
        await fillMissing(sessionMedia.readData, patch, sessionMedia.add, controller.signal, progress, { resolve: sessionMedia.resolve });
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '配音生成失败');
      else setGenerationStatus('已停止等待。本地模型可能仍在处理已提交的句子。');
    } finally {
      if (generationController.current === controller) {
        generationController.current = null;
        setGenerating(false);
        onGenerationChange?.(false);
      }
    }
  }

  function stopCandidatePreview() {
    playRequest.current++;
    video.current?.pause();
    stop();
    queue.current = null;
    previewEndMs.current = null;
    previewData.current = null;
  }

  function reviewCandidate(take: DubbingCandidate, start: number | null, end: number | null) {
    try {
      const adoption = adoptDubbingCandidate(latest.current.raw, take);
      void playPreview(start, end, { ...latest.current.data, ...adoption });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法试听新配音'); }
  }

  function applyCandidate(take: DubbingCandidate) {
    try {
      const changes = adoptDubbingCandidate(latest.current.raw, take);
      stopCandidatePreview();
      if (!patch(changes)) return;
      setCandidate(null);
      setGenerationStatus('已换成新配音。');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '替换配音失败'); }
  }

  function seek(ms: number | null) {
    if (!video.current || !finiteMs(ms)) return;
    playRequest.current++;
    queue.current = null;
    previewData.current = null;
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

  async function playPreview(startMs?: number | null, endMs?: number | null, preview?: Pick<DramaAudioData, 'segments' | 'audioRef' | 'masterGain'>, ranges?: PlaybackRange[], loop = false) {
    const element = video.current;
    if (!element) return;
    const request = ++playRequest.current;
    element.pause();
    const planData = preview ?? latest.current.data;
    const plan = planFor(planData, startMs ?? element.currentTime * 1000);
    if (plan.length && (!loaded.current || plan.some(item => !buffers.current.has(item.audioRef)))) {
      await loadAudio(planData, latest.current.listenMode, startMs ?? element.currentTime * 1000);
      if (!loaded.current) return;
    }
    if (request !== playRequest.current) return;
    if (finiteMs(startMs)) seek(startMs);
    queue.current = ranges?.length ? { ranges, index: 0, loop } : null;
    previewData.current = preview ?? null;
    previewEndMs.current = finiteMs(endMs) ? endMs : null;
    try { await element.play(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '视频无法播放'); }
  }

  useEffect(() => {
    if (!playback) return;
    playback.current = {
      play: (ranges, loop, audition) => playPreview(ranges?.[0]?.startMs, ranges?.[0]?.endMs, audition, ranges, loop),
      stop: stopCandidatePreview,
      seek,
    };
    return () => { playback.current = null; };
  });

  function seekTrack(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width > 0) seek(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * videoDurationMs);
  }

  function blockStyle(start: number | null, end: number | null): React.CSSProperties | null {
    if (!validWindow(start, end) || videoDurationMs <= 0 || start! >= videoDurationMs) return null;
    return { ...styles.block, left: `${start! / videoDurationMs * 100}%`, width: `${(Math.min(end!, videoDurationMs) - start!) / videoDurationMs * 100}%` };
  }

  return <section className="nodrag nopan" style={externalVideoRef ? { ...styles.root, background: 'transparent' } : styles.root} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    {!listOnly && <>
    <details open={!externalVideoRef} style={externalVideoRef ? { order: 2 } : undefined}>
    <summary style={styles.collapsedRow}>{externalVideoRef ? '整体音色与播放设置' : '整体配音设置与播放控制'}</summary>
    {!externalVideoRef && <><strong>逐句配音编辑</strong>
    <div style={styles.hint}>视频是唯一主时钟。自动建议尚待逐句确认；静音不压缩视频，停顿保留在视频区间尾部。</div></>}
    {!canGenerate && <div style={styles.warning}>本机 VoxCPM 仅在回环地址下可用。</div>}
    {videoUrl && !externalVideoRef ? <video ref={video} src={videoUrl} controls muted={!originalAudio} preload="metadata" style={{ width: '100%', maxHeight: 260, background: '#000', borderRadius: 6 }}
      onError={() => { stop(); setError('视频读取失败，无法同步试听'); }} /> : !externalVideoRef && <div style={styles.warning}>未绑定有效视频工程文件</div>}
    <div style={styles.row}>
      {!externalVideoRef && <label><input type="checkbox" checked={originalAudio} onChange={event => setOriginalAudio(event.target.checked)} />播放视频原声（默认关闭）</label>}
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
      <button style={styles.button} disabled={!canGenerate || startingTts || generating} onClick={() => void startTtsService()}>{startingTts ? '检查中…' : '检查本地 TTS'}</button>
      <button style={{ ...styles.primaryButton, opacity: !canGenerate || !rows.length || generating || loading || startingTts ? 0.45 : 1 }} disabled={!canGenerate || !counts.missing || generating || loading || startingTts || batchGenerating} onClick={() => void generate()}>补齐逐句配音</button>
      {generating && <button style={styles.dangerButton} onClick={() => { generationController.current?.abort(); setGenerationStatus('已请求停止；已有音频保留，未完成结果不自动重试'); }}>停止生成</button>}
      <button style={styles.button} disabled={!videoUrl || loading || generating} onClick={() => void loadAudio(latest.current.data, 'voice')}>载入配音试听</button>
      <button style={styles.successButton} disabled={!videoUrl || loading || generating} onClick={() => void playPreview()}>同步播放</button>
      <button style={styles.button} disabled={!videoUrl} onClick={stopCandidatePreview}>暂停</button>
    </div>
    <input aria-label="视频与配音统一播放位置" type="range" min={0} max={Math.max(1, videoDurationMs)} step={1} value={Math.min(currentMs, videoDurationMs)}
      style={{ width: '100%', accentColor: '#2563eb' }} onChange={event => seek(Number(event.target.value))} />
    {mediaDurationMs > 0 && Math.abs(mediaDurationMs - data.videoDurationMs) > 50 && <div style={styles.warning}>已按视频实际时长同步时间轴；保存时长与媒体不同，配音区间仍需人工核对。</div>}
    <div role="status" style={styles.hint}>{loadStatus}{generationStatus && <div>{generationStatus}</div>}</div>
    {error && <div role="alert" style={styles.error}>{error}</div>}
    </details>
    {externalVideoRef && error && <div role="alert" style={styles.error}>{error}</div>}
    {!externalVideoRef && <div style={styles.panel}>
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
          style={{ ...style, borderColor: drag?.id === line.id ? 'var(--director-error, #cf2e2e)' : segment && excessMs(segment) > 0 ? 'var(--director-error, #cf2e2e)' : '#0c87fa', background: segment?.muted ? '#ddd' : 'rgba(12,135,250,.15)', zIndex: drag?.id === line.id ? 2 : undefined, opacity: drag?.id === line.id ? 0.9 : 1 }}
          title={`${line.text}；${confirmed.includes(line.id) ? '已人工确认' : '自动建议尚待确认'}；拖拽整体平移（保持时长），点击定位视频`}
          onPointerDown={onBlockPointerDown} onPointerMove={onBlockPointerMove} onPointerUp={onBlockPointerUp}
          onPointerCancel={() => setDrag(null)} onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectLine(line.id); seek(start); }
          }}>{line.text}{segment?.muted ? '（静音）' : ''}{dragging ? '（拖拽中）' : ''}</div>;
      })}<div style={{ position: 'absolute', left: `${videoDurationMs > 0 ? Math.min(100, currentMs / videoDurationMs * 100) : 0}%`, top: 0, bottom: 0, width: 2, background: '#dc2626', pointerEvents: 'none' }} /></div>
    </div>}
    </>}
    {(listOnly || externalVideoRef) && <>
    {!externalVideoRef && <strong>配音句列表与细节编辑</strong>}
    {(!externalVideoRef || generationStatus) && <div role="status" style={styles.hint}>{!externalVideoRef && `当前配音 ${counts.current}/${counts.total} · 待补 ${counts.missing} · 待更新 ${counts.stale} · 区间已确认 ${counts.confirmed}`}{generationStatus && `${externalVideoRef ? '' : ' · '}${generationStatus}`}</div>}
    {error && <div role="alert" style={styles.error}>{error}</div>}
    <div style={styles.row}>
      {!externalVideoRef && <strong>配音句列表 · {rows.length} 句</strong>}
      {!externalVideoRef && <button style={styles.button} aria-expanded={showLineList} onClick={() => setShowLineList(value => !value)}>{showLineList ? '收起配音列表' : '展开配音列表'}</button>}
      {!externalVideoRef && <button style={styles.button} disabled={!expandedId} onClick={() => { setExpandedId(null); onLineSelect?.(null); }}>收起句子编辑</button>}
      {!externalVideoRef && <button style={styles.button} disabled={!canUndo || generating} onClick={undoStructure}>撤销增删</button>}
      {externalVideoRef && expandedId && <>
        <button style={styles.button} disabled={rows.findIndex(line => line.id === expandedId) <= 0} onClick={() => selectLine(rows[rows.findIndex(line => line.id === expandedId) - 1]!.id)}>上一句</button>
        <button style={styles.button} disabled={rows.findIndex(line => line.id === expandedId) >= rows.length - 1} onClick={() => selectLine(rows[rows.findIndex(line => line.id === expandedId) + 1]!.id)}>下一句</button>
      </>}
    </div>
    {showLineList && <div ref={lineList} role="region" aria-label="配音句滚动列表" tabIndex={0}
      style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 8, maxHeight: externalVideoRef ? undefined : 340, overflowY: externalVideoRef ? 'visible' : 'auto', overscrollBehavior: 'contain', padding: 2, scrollbarGutter: 'stable' }}
      onWheel={event => event.stopPropagation()}>
    {rows.filter(line => !externalVideoRef || !expandedId || line.id === expandedId).map((line) => {
      const index = rows.findIndex(item => item.id === line.id);
      const segment = data.segments.find(item => item.id === line.id);
      const start = segment ? segment.videoStartMs : line.videoStartMs;
      const end = segment ? segment.videoEndMs : line.videoEndMs;
      const over = segment ? excessMs(segment) : 0;
      const stale = lines.some(item => item.id === line.id) && !!segment && !lineGenerationCurrent(raw, line.id, line.text);
      const legacy = stale && (raw.generatedLineTexts as Record<string, unknown> | undefined)?.[line.id] === line.text
        && (raw.generatedLineVoices as Record<string, unknown> | undefined)?.[line.id] === undefined;
      const lineVoice = (raw.lineVoiceInstructions as Record<string, string> | undefined)?.[line.id] ?? null;
      const lineGain = segment?.gain ?? (raw.lineGains as Record<string, number> | undefined)?.[line.id] ?? 1;
      const buffer = segment ? buffers.current.get(segment.audioRefOverride ?? data.audioRef ?? '') : undefined;
      const expanded = expandedId === line.id;
      const badge = drag?.id === line.id && drag.moved ? '拖拽中' : segment?.muted ? '静音' : legacy ? '旧配音待核对' : stale ? '配音待更新' : !segment ? '未生成' : confirmed.includes(line.id) ? '已确认' : '待确认';
      return <div key={line.id} data-line-id={line.id} style={{ ...styles.panel, flexShrink: 0, ...(externalVideoRef ? { border: 0, padding: 0, gap: 14 } : {}) }}>
        {!externalVideoRef && <div style={styles.collapsedRow} onClick={() => { setExpandedId(expanded ? null : line.id); onLineSelect?.(expanded ? null : line.id); }} role="button" tabIndex={0}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setExpandedId(expanded ? null : line.id); onLineSelect?.(expanded ? null : line.id); } }}>
          <strong>第 {index + 1} 句</strong>
          <span style={styles.collapsedText} title={line.text}>{line.text}</span>
          <span style={styles.badge}>{badge}</span>
          <span style={styles.hint}>{validWindow(start, end) ? `${Math.round(start!)}–${Math.round(end!)}ms` : '未对齐'}</span>
          <span style={styles.hint}>{expanded ? '收起 ▲' : '展开 ▼'}</span>
        </div>}
        {expanded && <>
        <label>{externalVideoRef ? '台词内容' : '台词标签'}<textarea value={line.text} style={{ ...styles.input, display: 'block', width: '100%', boxSizing: 'border-box', minHeight: externalVideoRef ? 92 : 52 }}
          onChange={event => editLine(line.id, event.target.value)} /></label>
        <VoicePicker value={lineVoice} label="本句音色"
          defaultLabel={reference && reference.lineId !== line.id ? `跟随第 ${Math.max(1, rows.findIndex(item => item.id === reference.lineId) + 1)} 句的音色` : `跟随整体：${voiceName(voiceInstructionOf(raw))}`}
          defaultHint={reference && reference.lineId !== line.id ? '这句没有单独设置音色，生成时克隆音色基准的声音' : '这句没有单独设置音色，生成时用整体音色'}
          styles={styles} onChange={value => editLineVoice(line.id, value)} />
        {reference?.lineId === line.id
          ? <div style={styles.row}><span style={styles.hint}>这句是音色基准，其他句子会按它的声音生成</span>
              <button style={styles.button} onClick={() => patch({ voiceReference: null })}>取消基准</button></div>
          : segment && (segment.audioRefOverride ?? data.audioRef) && <div style={styles.row}>
              <span style={styles.hint}>{reference ? '已有音色基准，可以改用这句' : '各句声音不统一时，选一句满意的作为基准'}</span>
              <button style={styles.button} disabled={generating || loading} onClick={() => patch({ voiceReference: {
                lineId: line.id, audioRef: segment.audioRefOverride ?? data.audioRef, startMs: segment.startMs, endMs: segment.endMs, text: line.text,
                voice: (raw.generatedLineVoices as Record<string, unknown> | undefined)?.[line.id] ?? effectiveLineVoice(raw, line.id),
              } })}>设为音色基准</button></div>}
        <div style={styles.row}>
          <NumberField label={externalVideoRef ? '本句音量（0–2）' : '本句音量 0..2'} value={lineGain} max={2} onChange={value => { if (value !== null) editLineGain(line.id, value); }} />
          <span style={styles.hint}>试听音量 = 总音量 × 本句音量；改音量无需重新生成</span>
          <button style={styles.primaryButton} disabled={generating || startingTts || batchGenerating || loading || !canGenerate} title="用本机 VoxCPM 生成这一句；生成后先试听，满意再替换" onClick={() => void generate(line.id)}>{segment ? '重新生成' : '生成配音'}</button>
        </div>
        {generating && externalVideoRef && <button style={styles.button} onClick={() => generationController.current?.abort()}>停止等待配音</button>}
        {candidate?.lineId === line.id && <div style={styles.row}>
          <strong>新配音 · {(candidate.durationMs / 1000).toFixed(2)} 秒</strong>
          <span style={styles.hint}>{segment ? '先试听，满意再替换当前配音' : '先试听，满意就用这条'}</span>
          <button style={styles.button} disabled={!validWindow(start, end) || !candidateMatches(raw, candidate) || loading} onClick={() => reviewCandidate(candidate, start, end)}>试听</button>
          <button style={styles.successButton} disabled={!candidateMatches(raw, candidate)} onClick={() => applyCandidate(candidate)}>用这条</button>
          <button style={styles.button} onClick={() => { stopCandidatePreview(); setCandidate(null); setGenerationStatus('已放弃新配音。'); }}>不要</button>
          {!candidateMatches(raw, candidate) && <span style={styles.warning}>当前输入已变化，请重新生成。</span>}
        </div>}
        {stale && <div style={styles.warning}>{legacy ? '旧配音缺少音色记录，可以正常试听。' : '文字或音色已修改，可以试听旧配音，或点「重新生成」。'}</div>}
        {!segment && <div style={styles.hint}>本句尚未生成真实音频。</div>}
        <div style={styles.row}>{!externalVideoRef && <strong>{line.id}</strong>}<span style={styles.hint}>{confirmed.includes(line.id) ? '已人工确认视频区间' : '自动建议尚待确认'}</span>
          {!externalVideoRef && <button style={styles.button} disabled={!validWindow(start, end)} onClick={() => seek(start)}>定位视频</button>}
          <button style={styles.primaryButton} disabled={!segment || !validWindow(start, end) || loading || generating} onClick={() => void playPreview(start, end)}>本句同步试听</button>
          <button style={styles.successButton} disabled={!validWindow(start, end) || confirmed.includes(line.id)} onClick={() => {
            const ids = latest.current.raw.confirmedLineIds;
            patch({ confirmedLineIds: [...new Set([...(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []), line.id])] });
          }}>确认本句区间</button>
        </div>
        <details open={externalVideoRef ? undefined : true}><summary style={styles.collapsedRow}>时间与音频裁剪</summary>
        <div style={styles.row}>
          <NumberField label={externalVideoRef ? '画面入点（毫秒）' : '视频 startMs'} value={start} onChange={value => editSegment(line.id, { videoStartMs: value })} />
          <NumberField label={externalVideoRef ? '画面出点（毫秒）' : '视频 endMs'} value={end} onChange={value => editSegment(line.id, { videoEndMs: value })} />
        </div>
        {segment && <>
          <div style={styles.row}>
            <NumberField label={externalVideoRef ? '音频入点（毫秒）' : '源截取 startMs'} value={segment.startMs} onChange={value => { if (value !== null) editSegment(line.id, { startMs: value }); }} />
            <NumberField label={externalVideoRef ? '音频出点（毫秒）' : '源截取 endMs'} value={segment.endMs} onChange={value => { if (value !== null) editSegment(line.id, { endMs: value }); }} />
            <NumberField label={externalVideoRef ? '句尾留白（毫秒）' : '段后 gapMs'} value={segment.gapMs} onChange={value => { if (value !== null) editSegment(line.id, { gapMs: value }); }} />
            <label><input type="checkbox" checked={segment.muted} onChange={event => editSegment(line.id, { muted: event.target.checked })} />静音本句（保留时间位置）</label>
          </div>
          <div style={{ ...styles.hint, overflowWrap: 'anywhere' }}>音频源：{segment.audioRefOverride ?? data.audioRef ?? '未绑定'}</div>
        </>}
        </details>
        {segment && <>
          {!validWindow(start, end) && <div style={styles.warning}>视频区间未对齐或非法，本句不播放。</div>}
          {!validWindow(segment.startMs, segment.endMs) && <div style={styles.error}>源截取区间非法，本句不播放。</div>}
          {over > 0 && <div style={styles.error}>配音比区间长 {Math.ceil(over)} ms，超出部分会被截掉。点时间轴上的「贴合视频」自动排布，或改短台词后重新生成。</div>}
          {(segment.fitSpeed ?? 1) > 1 && <div style={styles.hint}>贴合视频时已保持音调加速到 {(segment.fitSpeed ?? 1).toFixed(2)} 倍。</div>}
          {finiteMs(end) && videoDurationMs > 0 && end > videoDurationMs && <div style={styles.error}>视频区间超过视频总时长，请调整。</div>}
          {buffer && segment.endMs > buffer.duration * 1000 + 1 && <div style={styles.error}>源截取超过真实音频时长 {Math.round(buffer.duration * 1000)} ms；试听仅播放实际存在的音频。</div>}
        </>}
        <details open={externalVideoRef ? undefined : true}><summary style={styles.collapsedRow}>增删台词</summary>
        <div style={styles.row}>
          <button style={styles.button} disabled={generating || startingTts} onClick={() => changeLineStructure(line.id, 'before')}>前插一句</button>
          <button style={styles.button} disabled={generating || startingTts} onClick={() => changeLineStructure(line.id, 'after')}>后插一句</button>
          <button style={styles.dangerButton} disabled={generating || startingTts} onClick={() => changeLineStructure(line.id, 'delete')}>删除本句</button>
          <span style={styles.hint}>插入会平分本句视频区间；旧音频保留，区间需重新确认。</span>
        </div>
        </details>
        </>}
      </div>;
    })}
    </div>}
    </>}
  </section>;
}
