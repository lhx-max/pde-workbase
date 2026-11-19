import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CardRenderProps } from '@bezier/canvas-card-sdk';
import { adoptDubbingCandidate, candidateMatches, dubbingCounts, effectiveLineVoice, lineGenerationCurrent, voiceReferenceOf, type DubbingCandidate } from './dubbing';
import { checkLocalVoice, fillMissing, generateCandidate, localVoiceAvailable } from './director/local-voice';
import { requireMedia, type MediaLookup } from './director/media';
import { readDramaAudioData, shiftSegmentWindow } from './edl';
import { buildDirectorPlaybackPlan, gainAt, gainRegionsOf, originalGainOf, playbackDriftMs, resolvePlaybackDuration, scheduleMixGain, type AudioListenMode } from './playback-plan';
import { insertRewriteLine, validateRewriteLines, type RewriteLine as TimedRewriteLine } from './rewrite';
import type { DramaAudioData, DramaAudioSegment } from './types';
import { VoicePicker } from './voice-picker';
import { Check, ChevronRight, Play, RefreshCw } from './director/icons';

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

const button: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 30, padding: '0 12px', border: '1px solid var(--border-default, #e2e4e9)', borderRadius: 8, background: 'var(--surface, #fff)', color: 'var(--text-primary, #1f2329)', font: 'inherit', fontSize: 13, cursor: 'pointer' };
const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 12, padding: 12, fontSize: 13, color: 'var(--text-primary, #1f2329)', background: 'var(--bg-app, #fff)' },
  row: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  panel: { display: 'flex', flexDirection: 'column', gap: 8, padding: 10, border: '1px solid var(--border-default, #e2e4e9)', borderRadius: 10 },
  input: { width: 90, minHeight: 30, padding: '4px 8px', border: '1px solid var(--border-default, #e2e4e9)', borderRadius: 8, color: 'inherit', background: 'var(--surface, #fff)', font: 'inherit' },
  select: { minHeight: 30, padding: '0 8px', border: '1px solid var(--border-default, #e2e4e9)', borderRadius: 8, color: 'inherit', background: 'var(--surface, #fff)', font: 'inherit' },
  button,
  primaryButton: { ...button, border: '1px solid var(--primary, #1f2329)', background: 'var(--primary, #1f2329)', color: 'var(--on-primary, #fff)', fontWeight: 500 },
  successButton: { ...button, border: '1px solid transparent', background: 'var(--success-soft, #e5f5ec)', color: 'var(--success, #1e8e4f)', fontWeight: 500 },
  dangerButton: { ...button, border: '1px solid transparent', background: 'var(--danger-soft, #fdebed)', color: 'var(--danger, #c4323f)' },
  hint: { color: 'var(--text-secondary, #5f6670)', fontSize: 12, lineHeight: 1.6 },
  warning: { color: 'var(--director-warning, #a8620a)', fontSize: 12, lineHeight: 1.6 },
  error: { color: 'var(--director-error, #c4323f)', fontSize: 12, lineHeight: 1.6, fontWeight: 500 },
  track: { position: 'relative', height: 46, overflow: 'hidden', borderRadius: 6, background: 'var(--bg-secondary, #f0f1f4)' },
  block: { position: 'absolute', top: 5, height: 36, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', padding: '2px 4px', borderRadius: 4, border: '1px solid var(--accent, #5b4bdb)', color: 'inherit', background: 'var(--accent-soft, #efedfd)', cursor: 'grab', touchAction: 'none', userSelect: 'none' },
  collapsedRow: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', minHeight: 28, color: 'var(--text-secondary, #5f6670)', fontWeight: 500 },
  collapsedText: { flex: 1, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', color: 'inherit' },
  badge: { flexShrink: 0, padding: '1px 8px', borderRadius: 999, background: 'var(--subtle, #f0f1f4)', fontSize: 11, lineHeight: 1.6 },
  textarea: { display: 'block', width: '100%', minHeight: 84, padding: '10px 12px', border: '1px solid var(--border-default, #e2e4e9)', borderRadius: 10, background: 'var(--surface, #fff)', color: 'inherit', font: 'inherit', lineHeight: 1.6, resize: 'vertical', boxSizing: 'border-box' },
  field: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 32 },
  fieldLabel: { color: 'var(--text-secondary, #5f6670)', flexShrink: 0 },
  actions: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 },
  confirm: { ...button, width: '100%', border: '1px solid transparent', background: 'var(--success-soft, #e5f5ec)', color: 'var(--success, #1e8e4f)', fontWeight: 500 },
  section: { borderTop: '1px solid var(--border-default, #e2e4e9)', paddingTop: 4 },
  summary: { display: 'flex', alignItems: 'center', gap: 6, minHeight: 36, color: 'var(--text-secondary, #5f6670)', cursor: 'pointer', listStyle: 'none', userSelect: 'none' },
  sectionBody: { display: 'grid', gap: 10, padding: '4px 0 10px' },
  referenceRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--subtle, #f0f1f4)', fontSize: 12 },
  textButton: { padding: 0, border: 0, background: 'none', color: 'var(--accent-text, #1f5bd1)', font: 'inherit', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' },
};

/** 右侧面板里的折叠段落：标题前带箭头，展开后显示内容。 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details style={styles.section} open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary style={styles.summary}><span style={{ display: 'inline-flex', transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }}><ChevronRight size={14} /></span>{title}</summary>
    <div style={styles.sectionBody}>{children}</div>
  </details>;
}

/** 百分比音量输入：显示 0–200%，失焦或回车后提交 0–2 的增益。 */
function PercentField({ label, value, onChange }: { label: string; value: number; onChange: (gain: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const percent = Number(draft);
    setDraft(null);
    if (draft.trim() && Number.isFinite(percent)) onChange(Math.round(Math.max(0, Math.min(200, percent))) / 100);
  };
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
    <input aria-label={label} type="number" min={0} max={200} step={5} value={draft ?? String(Math.round(value * 100))}
      style={{ ...styles.input, width: 72, textAlign: 'right' }} onChange={event => setDraft(event.target.value)} onBlur={commit}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
    <span style={styles.hint}>%</span>
  </span>;
}

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
  return Math.max(0, segment.endMs - segment.startMs - Math.max(0, segment.videoEndMs! - segment.videoStartMs! + (segment.leadMs ?? 0) - segment.gapMs));
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
  const canGenerate = localVoiceAvailable();
  const reference = voiceReferenceOf(node.data ?? {});
  const lines = readLines(raw.rewriteLines);
  const confirmed = Array.isArray(raw.confirmedLineIds) ? raw.confirmedLineIds.filter((id): id is string => typeof id === 'string') : [];
  const rows = [...lines, ...data.segments.filter(segment => !lines.some(line => line.id === segment.id)).map(segment => ({ id: segment.id, text: segment.label, videoStartMs: segment.videoStartMs, videoEndMs: segment.videoEndMs }))];
  const internalVideo = useRef<HTMLVideoElement>(null);
  const video = externalVideoRef ?? internalVideo;
  const context = useRef<AudioContext | null>(null);
  const buffers = useRef(new Map<string, AudioBuffer>());
  const sources = useRef(new Set<{ source: AudioBufferSourceNode; gain: GainNode }>());
  const loadController = useRef<AbortController | null>(null);
  const generationController = useRef<AbortController | null>(null);
  const epoch = useRef(0);
  const loaded = useRef(false);
  const clockAnchor = useRef<{ videoMs: number; audioSeconds: number; rate: number } | null>(null);
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
    if (!listOnly) return;
    const select = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.nodeId !== node.id || typeof detail.lineId !== 'string') return;
      setShowLineList(true);
      setExpandedId(detail.lineId);
    };
    window.addEventListener('drama-demo-select-line', select);
    return () => window.removeEventListener('drama-demo-select-line', select);
  }, [listOnly, node.id]);
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
    clockAnchor.current = { videoMs: element.currentTime * 1000, audioSeconds: at, rate };
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
        const buffer = buffers.current.get(item.audioRef);
        if (!buffer) continue;
        const offset = item.offsetMs / 1000;
        const duration = Math.min(item.durationMs / 1000, availableMs / 1000, buffer.duration - offset);
        if (duration <= 0) continue;
        const source = audioContext.createBufferSource();
        const gain = audioContext.createGain();
        const active = { source, gain };
        sources.current.add(active);
        source.buffer = buffer;
        source.playbackRate.setValueAtTime(rate, at);
        source.connect(gain);
        gain.connect(audioContext.destination);
        source.onended = () => {
          source.disconnect();
          gain.disconnect();
          sources.current.delete(active);
        };
        const when = at + item.delayMs / 1000 / rate;
        scheduleMixGain(gain.gain, regions[item.track], item.gain, startMs, startMs + duration * 1000, when, rate);
        source.start(when, offset, duration);
        source.stop(when + duration / rate);
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
      if (missing.length === refs.length) throw new Error(`这里的 ${missing.length} 段配音音频都未载入。可以在左侧重新生成，或从「⋯」恢复会话素材。`);
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
      setLoadStatus(`已载入 ${refs.length - missing.length} 个音频源；按视频时钟试听，不自动拉伸`);
      if (missing.length) setGenerationStatus(`${missing.length} 段配音音频未载入，试听时已跳过。可在左侧重新生成。`);
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
    if (plan.some(item => !buffers.current.has(item.audioRef))) void loadAudio(mix, current.listenMode, at);
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
    setGenerationStatus(onlyLineId ? '正在生成候选配音…' : '正在补齐缺失配音…');
    try {
      if (beforeGenerate && !await beforeGenerate()) throw new Error('请先解决草稿保存问题');
      if (onlyLineId) {
        const result = await generateCandidate(sessionMedia.readData, sessionMedia.add, onlyLineId, controller.signal, sessionMedia.resolve);
        setCandidate(result);
        setGenerationStatus('候选已就绪，可以试听后采用。');
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
    if (listOnly) window.dispatchEvent(new CustomEvent('drama-demo-preview', { detail: { nodeId: node.id, stop: true } }));
  }

  function reviewCandidate(take: DubbingCandidate, start: number | null, end: number | null) {
    try {
      const adoption = adoptDubbingCandidate(latest.current.raw, take);
      void playPreview(start, end, { ...latest.current.data, ...adoption });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法试听候选'); }
  }

  function applyCandidate(take: DubbingCandidate) {
    try {
      const changes = adoptDubbingCandidate(latest.current.raw, take);
      stopCandidatePreview();
      if (!patch(changes)) return;
      setCandidate(null);
      setGenerationStatus('已采用候选配音。');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '采用候选失败'); }
  }

  useEffect(() => {
    if (listOnly) return;
    const listener = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.nodeId !== node.id) return;
      if (detail.stop) stopCandidatePreview();
      else if (detail.play) void playPreview(detail.start, detail.end, detail.preview);
      else seek(detail.start);
    };
    window.addEventListener('drama-demo-preview', listener);
    return () => window.removeEventListener('drama-demo-preview', listener);
  }, [node.id, listOnly]);

  function seek(ms: number | null) {
    if (listOnly) {
      window.dispatchEvent(new CustomEvent('drama-demo-preview', { detail: { nodeId: node.id, start: ms } }));
      return;
    }
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
    if (listOnly) {
      window.dispatchEvent(new CustomEvent('drama-demo-preview', { detail: { nodeId: node.id, start: startMs, end: endMs, play: true, preview } }));
      return;
    }
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
    <details open={!externalVideoRef} style={externalVideoRef ? { ...styles.section, order: 2 } : undefined}>
    <summary style={externalVideoRef ? styles.summary : styles.collapsedRow}>{externalVideoRef && <ChevronRight size={14} />}{externalVideoRef ? '整体音色与倍速' : '整体配音设置与播放控制'}</summary>
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
    {reference && <div style={styles.hint}>已设音色基准：没有单独音色的句子会克隆基准音色，整体音色描述不再生效。</div>}
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
    {!externalVideoRef && error && <div role="alert" style={styles.error}>{error}</div>}
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
    {!externalVideoRef && error && <div role="alert" style={styles.error}>{error}</div>}
    <div style={styles.row}>
      {!externalVideoRef && <strong>配音句列表 · {rows.length} 句</strong>}
      {!externalVideoRef && <button style={styles.button} aria-expanded={showLineList} onClick={() => setShowLineList(value => !value)}>{showLineList ? '收起配音列表' : '展开配音列表'}</button>}
      {!externalVideoRef && <button style={styles.button} disabled={!expandedId} onClick={() => { setExpandedId(null); onLineSelect?.(null); }}>收起句子编辑</button>}
      {!externalVideoRef && <button style={styles.button} disabled={!canUndo || generating} onClick={undoStructure}>撤销增删</button>}
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
        {expanded && externalVideoRef && <>
        <textarea aria-label="台词内容" value={line.text} style={styles.textarea} onChange={event => editLine(line.id, event.target.value)} />
        <div style={styles.field}><span style={styles.fieldLabel}>音色</span>
          <VoicePicker value={lineVoice} label="本句音色" hideLabel defaultLabel={reference ? '跟随基准' : '继承整体'} styles={styles} onChange={value => editLineVoice(line.id, value)} /></div>
        {reference?.lineId === line.id
          ? <div style={styles.referenceRow}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Check size={14} />这句是音色基准，其他句子按它的音色生成</span>
              <button style={styles.textButton} onClick={() => patch({ voiceReference: null })}>取消基准</button></div>
          : segment && (segment.audioRefOverride ?? data.audioRef) && <div style={styles.referenceRow}>
              <span style={styles.hint}>{reference ? '已有音色基准，可改用这句' : '音色不统一时，选一句满意的作为基准'}</span>
              <button style={styles.textButton} disabled={generating || loading} onClick={() => patch({ voiceReference: {
                lineId: line.id, audioRef: segment.audioRefOverride ?? data.audioRef, startMs: segment.startMs, endMs: segment.endMs, text: line.text,
                voice: (raw.generatedLineVoices as Record<string, unknown> | undefined)?.[line.id] ?? effectiveLineVoice(raw, line.id),
              } })}>设为音色基准</button></div>}
        <div style={styles.field}><span style={styles.fieldLabel}>音量</span>
          <PercentField label="本句音量" value={lineGain} onChange={value => editLineGain(line.id, value)} /></div>
        <div style={styles.actions}>
          <button style={styles.button} disabled={!segment || !validWindow(start, end) || loading || generating} title={segment ? '对着画面试听这一句' : '这句还没有配音'} onClick={() => void playPreview(start, end)}><Play size={14} />试听本句</button>
          <button style={styles.button} disabled={generating || startingTts || batchGenerating || loading || !canGenerate}
            title={canGenerate ? '用本机 VoxCPM 生成这一句' : '本机配音需在 127.0.0.1 打开并启动 VoxCPM'} onClick={() => void generate(line.id)}><RefreshCw size={14} />{segment ? '重新生成' : '生成配音'}</button>
        </div>
        <button style={confirmed.includes(line.id) ? { ...styles.confirm, opacity: 0.7, cursor: 'default' } : styles.confirm} disabled={!validWindow(start, end) || confirmed.includes(line.id)} onClick={() => {
          const ids = latest.current.raw.confirmedLineIds;
          patch({ confirmedLineIds: [...new Set([...(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []), line.id])] });
        }}><Check size={14} />{confirmed.includes(line.id) ? '已确认' : '确认这句'}</button>
        {generating && <button style={styles.button} onClick={() => generationController.current?.abort()}>停止等待配音</button>}
        {candidate?.lineId === line.id && <div style={{ ...styles.panel, background: 'var(--subtle, #f0f1f4)', border: 0 }}>
          <strong>新配音 · {(candidate.durationMs / 1000).toFixed(2)} 秒</strong>
          <div style={styles.row}>
            <button style={styles.button} disabled={!validWindow(start, end) || !candidateMatches(raw, candidate) || loading} onClick={() => reviewCandidate(candidate, start, end)}><Play size={14} />同步试听候选</button>
            <button style={styles.primaryButton} disabled={!candidateMatches(raw, candidate)} onClick={() => applyCandidate(candidate)}>采用候选</button>
            <button style={styles.button} onClick={() => { stopCandidatePreview(); setCandidate(null); setGenerationStatus('已放弃候选。'); }}>放弃候选</button>
          </div>
          {!candidateMatches(raw, candidate) && <span style={styles.warning}>当前输入已变化，请重新生成。</span>}
        </div>}
        {stale && <div style={styles.warning}>{legacy ? '旧配音缺少音色记录，可以正常试听。' : '文字或音色改过了，可以重新生成。'}</div>}
        {segment && over > 0 && <div style={styles.error}>时长超限 {Math.ceil(over)} ms，试听会截断超出部分。</div>}
        {segment && !validWindow(start, end) && <div style={styles.warning}>视频区间未对齐或非法，本句不播放。</div>}
        {segment && finiteMs(end) && videoDurationMs > 0 && end > videoDurationMs && <div style={styles.error}>视频区间超过视频总时长，请调整。</div>}
        {buffer && segment && segment.endMs > buffer.duration * 1000 + 1 && <div style={styles.error}>源截取超过真实音频时长 {Math.round(buffer.duration * 1000)} ms。</div>}
        <Section title="时间与裁剪">
          <div style={styles.field}><NumberField label="画面入点（毫秒）" value={start} onChange={value => editSegment(line.id, { videoStartMs: value })} /></div>
          <div style={styles.field}><NumberField label="画面出点（毫秒）" value={end} onChange={value => editSegment(line.id, { videoEndMs: value })} /></div>
          {segment ? <>
            <div style={styles.field}><NumberField label="音频入点（毫秒）" value={segment.startMs} onChange={value => { if (value !== null) editSegment(line.id, { startMs: value }); }} /></div>
            <div style={styles.field}><NumberField label="音频出点（毫秒）" value={segment.endMs} onChange={value => { if (value !== null) editSegment(line.id, { endMs: value }); }} /></div>
            <div style={styles.field}><NumberField label="句尾留白（毫秒）" value={segment.gapMs} onChange={value => { if (value !== null) editSegment(line.id, { gapMs: value }); }} /></div>
            <label style={styles.row}><input type="checkbox" checked={segment.muted} onChange={event => editSegment(line.id, { muted: event.target.checked })} />静音本句（保留时间位置）</label>
            <div style={{ ...styles.hint, overflowWrap: 'anywhere' }}>音频源：{segment.audioRefOverride ?? data.audioRef ?? '未绑定'}</div>
          </> : <div style={styles.hint}>本句尚未生成真实音频。</div>}
        </Section>
        <Section title="增删台词">
          <div style={styles.row}>
            <button style={styles.button} disabled={generating || startingTts} onClick={() => changeLineStructure(line.id, 'before')}>前插一句</button>
            <button style={styles.button} disabled={generating || startingTts} onClick={() => changeLineStructure(line.id, 'after')}>后插一句</button>
            <button style={styles.dangerButton} disabled={generating || startingTts} onClick={() => changeLineStructure(line.id, 'delete')}>删除本句</button>
          </div>
          <span style={styles.hint}>插入会平分本句视频区间，旧音频保留。</span>
        </Section>
        </>}
        {expanded && !externalVideoRef && <>
        <label>{externalVideoRef ? '台词内容' : '台词标签'}<textarea value={line.text} style={{ ...styles.input, display: 'block', width: '100%', boxSizing: 'border-box', minHeight: externalVideoRef ? 92 : 52 }}
          onChange={event => editLine(line.id, event.target.value)} /></label>
        <VoicePicker value={lineVoice} label="本句音色" defaultLabel="继承整体音色" defaultHint={`当前生效：${effectiveLineVoice(raw, line.id)}`}
          styles={styles} onChange={value => editLineVoice(line.id, value)} />
        <div style={styles.row}>
          <NumberField label={externalVideoRef ? '本句音量（0–2）' : '本句音量 0..2'} value={lineGain} max={2} onChange={value => { if (value !== null) editLineGain(line.id, value); }} />
          <span style={styles.hint}>试听音量 = 总音量 × 本句音量；改音量无需重新生成</span>
          <button style={styles.primaryButton} disabled={generating || startingTts || batchGenerating || loading || !canGenerate} onClick={() => void generate(line.id)}>生成配音</button>
        </div>
        {generating && externalVideoRef && <button style={styles.button} onClick={() => generationController.current?.abort()}>停止等待配音</button>}
        {candidate?.lineId === line.id && <div style={styles.row}>
          <strong>候选配音 · {(candidate.durationMs / 1000).toFixed(2)} 秒</strong>
          <button style={styles.button} disabled={!validWindow(start, end) || !candidateMatches(raw, candidate) || loading} onClick={() => reviewCandidate(candidate, start, end)}>同步试听候选</button>
          <button style={styles.successButton} disabled={!candidateMatches(raw, candidate)} onClick={() => applyCandidate(candidate)}>采用候选</button>
          <button style={styles.button} onClick={() => { stopCandidatePreview(); setCandidate(null); setGenerationStatus('已放弃候选。'); }}>放弃候选</button>
          {!candidateMatches(raw, candidate) && <span style={styles.warning}>当前输入已变化，请重新生成。</span>}
        </div>}
        {stale && <div style={styles.warning}>{legacy ? '旧配音缺少音色记录，可以正常试听。' : '文字或音色已修改，可以试听旧配音或生成候选。'}</div>}
        {!segment && <div style={styles.hint}>本句尚未生成真实音频。</div>}
        <div style={styles.row}>{!externalVideoRef && <strong>{line.id}</strong>}<span style={styles.hint}>{confirmed.includes(line.id) ? '已人工确认视频区间' : '自动建议尚待确认'}</span>
          {!externalVideoRef && <button style={styles.button} disabled={!validWindow(start, end)} onClick={() => seek(start)}>定位视频</button>}
          <button style={styles.primaryButton} disabled={!segment || !validWindow(start, end) || loading || generating} onClick={() => void playPreview(start, end)}>试听本句</button>
          <button style={styles.successButton} disabled={!validWindow(start, end) || confirmed.includes(line.id)} onClick={() => {
            const ids = latest.current.raw.confirmedLineIds;
            patch({ confirmedLineIds: [...new Set([...(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []), line.id])] });
          }}>确认这句</button>
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
          {over > 0 && <div style={styles.error}>时长超限 {Math.ceil(over)} ms：试听会截断超出视频允许区间的音频，不自动拉伸，未宣称对齐。</div>}
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
