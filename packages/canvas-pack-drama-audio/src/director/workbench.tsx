'use client';

import { AlignHorizontal, AudioLines, Check, ChevronLeft, ChevronRight, ClipboardPaste, Copy, Download, FileText, Film, LocateFixed, Magnet, MoreHorizontal, Redo2, Scan, Scissors, Sparkles, Trash2, Undo2, Upload, X } from './icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CardRenderProps } from '@bezier/canvas-card-sdk';
import { DubbingEditor, type DubbingPlayback } from '../dubbing-editor';
import { changeRewriteWindow, validateRewriteLines, type RewriteLine as TimedDubbingLine } from '../rewrite';
import { dubbingCounts, lineGenerationCurrent, voiceReferenceOf } from '../dubbing';
import { resolvePlaybackDuration } from '../playback-plan';
import { assertMediaSize, type useSessionMedia } from './media';
import { fillMissing, localVoiceAvailable } from './local-voice';
import { exportHandoff, exportVideo } from './director-delivery';
import { createPeakReader, Waveform } from './waveform';
import { splitClip, trimClip, copyClip, pasteClip, deleteClip } from './clip-edits';
import type { ClipClipboard } from './clip-edits';
import { SplitClipDialog } from './split-clip-dialog';
import { RewritePanel } from './rewrite-panel';
import { TrackInspector } from './track-inspector';
import { ManualDialog } from './manual-dialog';
import { DirectorTools } from './director-tools';
import { assertUnlocked, directorOf, displayTime, listenLabel, makeRange, moveRangeBoundary, overlaps, rewriteWindows } from './director-edits';
import type { EditData, ListenMode, TimeRange } from './director-edits';
import { useCardEdits } from './use-card-edits';
import { describeFit, fitTimeline, joinsOf, LAYOUT, setJoin } from './layout';
import { audioDurationOf, deliveryIssues, download, exportSubtitles, exportWav, importScript, importVoice, linesOf, videoDurationOf } from './director-media';
import styles from './workbench.module.css';

/** 音频编辑工作台：视频与时间轴并排，选中内容在右侧编辑。 */

interface EditorSegment { leadMs?: number; startMs?: number; endMs?: number; gapMs?: number; gain?: number; audioRefOverride?: string | null; id: string; text?: string; label?: string; muted?: boolean; videoStartMs?: number | null; videoEndMs?: number | null }
type TimelineTrack = 'original' | 'voice' | 'background';
type LineState = 'missing' | 'stale' | 'voiced' | 'over';
const LINE_STATE_LABEL: Record<LineState, string> = { missing: '缺配音', stale: '待更新', voiced: '已配音', over: '配音超出区间，会被截断' };
/** 时间显示为 分:秒，如 2:53。 */
function shortTime(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
/** 音轨缩放档位；默认让一屏约显示 20 秒。 */
const ZOOMS = [1, 2, 4, 8, 16, 32] as const;
const VISIBLE_MS = 20_000;
export function defaultZoom(durationMs: number) {
  const target = durationMs / VISIBLE_MS;
  return ZOOMS.reduce<number>((best, zoom) => zoom <= Math.max(1, target) ? zoom : best, 1);
}
const SAVE_LABEL = { synced: '已保存', pending: '保存中…', unconfirmed: '未确认', external: '已载入最新', error: '未应用' } as const;
type BoundaryDrag = { range: TimeRange; index: number; edge: keyof TimeRange; pointer: number; x: number; width: number };

export function Workbench({ node: editorNode, onPatch, onOpenFile, media, onClose }: CardRenderProps & {
  media: ReturnType<typeof useSessionMedia>;
  onClose: () => void;
}) {
  const readPeaks = useMemo(createPeakReader, []);
  const [selectedTrack, setSelectedTrack] = useState<TimelineTrack | null>(null);
  const [splitRequest, setSplitRequest] = useState<{ id: string; atMs: number; text: string } | null>(null);
  const [clipboard, setClipboard] = useState<{ project: string; clip: ClipClipboard } | null>(null);
  const [clipMenu, setClipMenu] = useState<{ x: number; y: number } | null>(null);
  const [snapping, setSnapping] = useState(true);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const timelineViewport = useRef<HTMLDivElement>(null);
  const [followPlayhead, setFollowPlayhead] = useState(true);
  const editor = useCardEdits(editorNode, onPatch);
  const previewVideo = useRef<HTMLVideoElement>(null);
  const live = useRef(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [autoFit, setAutoFit] = useState(true);
  const [showExport, setShowExport] = useState(false);
  const scriptList = useRef<HTMLDivElement>(null);
  const [videoSize, setVideoSize] = useState({ width: 16, height: 9, durationMs: 0 });
  const [previewMs, setPreviewMs] = useState(0);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [trackView, setTrackView] = useState<'all' | 'focused'>('all');
  const [trackZoom, setTrackZoom] = useState(1);
  const trackDrag = useRef<{ line: EditorSegment; x: number; pointer: number; width: number; span: number; mode: 'move' | 'start' | 'end'; delta: number } | null>(null);
  const [toolStatus, setToolStatus] = useState('');
  const [generating, setGenerating] = useState(false);
  const [lineGenerating, setLineGenerating] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [burnCaptions, setBurnCaptions] = useState(true);
  const exportController = useRef<AbortController | null>(null);
  const playback = useRef<DubbingPlayback | null>(null);
  const [listenMode, setListenMode] = useState<ListenMode>('voice');
  const originalAudio = listenMode === 'mix' || listenMode === 'original';
  const [theme, setTheme] = useState<'dark' | 'light'>('light');
  const [ranges, setRanges] = useState<TimeRange[]>([]);
  const [selectionTrack, setSelectionTrack] = useState<TimelineTrack>('original');
  const [rangeDraft, setRangeDraft] = useState<TimeRange | null>(null);
  const rangeDrag = useRef<{ track: TimelineTrack; start: number; add: boolean; x: number; pointer: number; line?: EditorSegment | undefined } | null>(null);
  const [boundaryDraft, setBoundaryDraft] = useState<{ index: number; range: TimeRange } | null>(null);
  const boundaryDrag = useRef<BoundaryDrag | null>(null);
  const voiceTarget = useRef<string | undefined>(undefined);
  const [confirmation, setConfirmation] = useState<{ message: string; label: string } | null>(null);
  const confirmationAnswer = useRef<((value: boolean) => void) | null>(null);
  const [trackGhost, setTrackGhost] = useState<EditorSegment | null>(null);
  const generateController = useRef<AbortController | null>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const voiceInput = useRef<HTMLInputElement>(null);
  const backgroundInput = useRef<HTMLInputElement>(null);
  const scriptInput = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let frame = 0;
    const update = () => { setPreviewMs((previewVideo.current?.currentTime ?? 0) * 1000); frame = requestAnimationFrame(update); };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      generateController.current?.abort();
      exportController.current?.abort();
      confirmationAnswer.current?.(false);
    };
  }, []);

  function ask(message: string, label = '继续') {
    if (confirmationAnswer.current) return Promise.resolve(false);
    setConfirmation({ message, label });
    return new Promise<boolean>(resolve => { confirmationAnswer.current = resolve; });
  }

  function answerConfirmation(accepted: boolean) {
    const answer = confirmationAnswer.current;
    confirmationAnswer.current = null;
    setConfirmation(null);
    answer?.(accepted);
  }

  async function generateVoice(mode: 'missing' | 'offline' | 'stale' = 'missing') {
    if (!localVoiceAvailable() || generateController.current || lineGenerating || mediaBusy || deliveryBusy) return;
    const controller = new AbortController();
    generateController.current = controller;
    setGenerating(true);
    setToolStatus(mode === 'stale' ? '正在更新配音…' : mode === 'offline' ? '正在重新生成未载入的配音…' : '正在补齐缺失配音…');
    try {
      await fillMissing(editor.draftData, applyEdit, media.add, controller.signal, setToolStatus, { resolve: media.resolve, stale: mode === 'stale', offline: mode === 'offline' });
    } catch (reason) {
      if (!controller.signal.aborted) {
        setToolStatus(reason instanceof Error ? reason.message : '逐句生成失败；不自动重试');
      } else setToolStatus('已停止等待，已回填音频保留。本地模型可能仍在处理已提交的句子。');
    } finally {
      if (generateController.current === controller) generateController.current = null;
      setGenerating(false);
    }
  }

  async function handleImport(kind: 'media' | 'voice' | 'script' | 'background', file: File, lineId?: string) {
    if (!editorNode || mediaBusy || generating || lineGenerating || deliveryBusy) return;
    setMediaBusy(true);
    try {
      const current = editor.draftData();
      if (kind !== 'script') assertMediaSize(file);
      if (kind === 'script' && file.size > 100_000) throw new Error('台词文件不得超过 100 KB。');
      const hasEdits = linesOf(current).length > 0 || (Array.isArray(current.segments) && current.segments.length > 0);
      if (kind === 'media') assertUnlocked(current, { videoRef: 'inputs/media/import-preview' });
      if (kind !== 'background' && hasEdits && !await ask(kind === 'media'
        ? '设为主视频后，台词区间将重新待确认。是否继续？'
        : kind === 'script' ? '导入台词将更新当前列表，变更的台词需要核对配音。是否继续？'
        : lineId ? '替换当前句的配音。是否继续？' : '使用导入音频替换配音音轨，并按视频区间取音。', '确认导入')) return;
      setToolStatus(`正在导入 ${file.name}…`);
      let changes: Record<string, unknown>;
      if (kind === 'media') {
        const ms = await videoDurationOf(file);
        const previousDuration = Number(current.videoDurationMs) || ms;
        const oldLines = linesOf(current);
        const retime = oldLines.some(line => line.videoEndMs > ms);
        if (retime && !await ask('新视频更短，需要按比例调整原台词区间。', '调整并绑定')) return;
        const mapTime = (value: number) => retime ? Math.min(ms, Math.round(value * ms / previousDuration)) : value;
        const rows = oldLines.length ? validateRewriteLines(oldLines.map(line => ({
          ...line, videoStartMs: mapTime(line.videoStartMs), videoEndMs: mapTime(line.videoEndMs),
        })), ms) : [];
        const oldSegments = (current.segments ?? []) as EditorSegment[];
        const nextSegments = oldSegments.map(segment => ({
          ...segment, videoStartMs: segment.videoStartMs == null ? null : mapTime(segment.videoStartMs),
          videoEndMs: segment.videoEndMs == null ? null : Math.min(ms, mapTime(segment.videoEndMs)),
        }));
        const ref = await media.add(file);
        changes = { videoRef: ref, videoDurationMs: ms, rewriteLines: rows, segments: nextSegments, confirmedLineIds: [] };
      } else if (kind === 'script') {
        changes = importScript(current, await file.text(), durationMs);
      } else {
        const ms = await audioDurationOf(file);
        if (kind === 'background') {
          const ref = await media.add(file);
          changes = { directorBackgroundRef: ref, directorBackgroundDurationMs: ms };
        } else {
          assertUnlocked(current, importVoice(current, 'outputs/voice/check.wav', ms, durationMs, lineId));
          const audioRef = await media.add(file);
          changes = importVoice(current, audioRef, ms, durationMs, lineId);
        }
      }
      if (!live.current) return;
      if (editor.draftData() !== current) {
        throw new Error('编辑内容已变化，请核对当前卡片后重新导入。');
      }
      assertUnlocked(current, changes);
      editor.patch(changes);
      if (kind === 'media') setRanges([]);
      if (kind === 'media' || kind === 'script') setSelectedLineId(null);
      if (kind === 'background') setListenMode('mix');
      const message = kind === 'media' ? `已将「${file.name}」设为主视频。`
        : kind === 'script' ? '台词已进入逐句列表，请检查建议区间。'
        : kind === 'background' ? `「${file.name}」已加入背景音乐轨。`
        : lineId ? '本句音频已替换，可以同步试听。' : '整轨配音已绑定，可以同步试听。';
      setToolStatus(message);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '导入失败';
      setToolStatus(message);
    } finally {
      setMediaBusy(false);
    }
  }

  async function deliver(kind: 'wav' | 'srt' | 'mp4' | 'zip') {
    if (!editorNode || exportController.current || mediaBusy || generating || lineGenerating) return;
    const controller = new AbortController();
    exportController.current = controller;
    setDeliveryBusy(true);
    try {
      const data = editor.draftData() ?? {};
      // 导出弹窗已列出检查项，这里不再二次确认。
      setToolStatus('正在准备导出…');
      playback.current?.stop();
      const range = kind === 'mp4' && ranges.length === 1 ? ranges[0]! : { startMs: 0, endMs: durationMs };
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(kind === 'mp4' ? range.endMs - range.startMs + 180_000 : 180_000)]);
      let blob: Blob;
      let name: string;
      switch (kind) {
        case 'srt':
          blob = exportSubtitles(data, durationMs);
          name = '短剧台词.srt';
          break;
        case 'wav':
          blob = await exportWav(data, media.resolve, durationMs, listenMode, signal);
          name = `短剧${listenLabel[listenMode]}.wav`;
          break;
        case 'mp4':
          blob = await exportVideo(data, videoUrl, media.resolve, range, listenMode, burnCaptions, signal,
            percent => setToolStatus(`正在录制 MP4 ${percent}% · 保持页面前台`));
          name = ranges.length === 1 ? '短剧选区.mp4' : '短剧全片.mp4';
          break;
        case 'zip':
          blob = await exportHandoff(data, media.resolve, durationMs, listenMode, signal);
          name = '短剧剪辑交接包.zip';
          break;
      }
      signal.throwIfAborted();
      download(blob, name);
      setToolStatus(`${name} 已生成。`);
    } catch (reason) {
      setToolStatus(controller.signal.aborted ? '已取消导出。' : reason instanceof Error ? reason.message : '导出失败');
    } finally {
      exportController.current = null;
      setDeliveryBusy(false);
    }
  }

  function chooseVoice(lineId?: string) {
    voiceTarget.current = lineId;
    voiceInput.current?.click();
  }

  async function restoreFiles(files: File[]) {
    if (!files.length || projectBusy) return;
    setMediaBusy(true);
    try {
      const refs = mediaRefs();
      let matched = 0;
      for (const file of files) {
        if (await media.restore(file, refs)) matched++;
      }
      setToolStatus(`恢复了 ${matched}/${files.length} 个素材。请使用内容相同的原文件。`);
    } catch (error) {
      setToolStatus(error instanceof Error ? error.message : '恢复素材失败。');
    } finally { setMediaBusy(false); }
  }

  const data = editorNode?.data ?? {};
  const director = directorOf(data);
  const editorData = data as { videoRef?: string | null; videoDurationMs?: number; segments?: EditorSegment[]; rewriteLines?: EditorSegment[]; confirmedLineIds?: string[] };
  const hasBackground = typeof data.directorBackgroundRef === 'string' && Boolean(data.directorBackgroundRef);
  const backgroundEnd = Math.min(Number(data.directorBackgroundDurationMs) || 0, Number(editorData.videoDurationMs) || Infinity);
  const videoUrl = editorData.videoRef ? media.resolve(editorData.videoRef) ?? '' : '';
  const durationMs = resolvePlaybackDuration(Number(editorData.videoDurationMs ?? 0), videoSize.durationMs);
  const counts = dubbingCounts(editorNode?.data ?? {});
  const checking = editorNode ? deliveryIssues(editorNode.data ?? {}, durationMs) : [];
  const projectBusy = mediaBusy || generating || lineGenerating || deliveryBusy;
  const segments = Array.isArray(editorData.segments) ? editorData.segments : [];
  const rewriteLines = linesOf(data);
  const trackLines = rewriteLines.length ? rewriteLines.map(line => ({ ...segments.find(segment => segment.id === line.id), ...line })) : segments;
  const voiced = trackLines.filter(segment => Number.isFinite(segment.videoStartMs) && Number.isFinite(segment.videoEndMs)
    && (segment.videoEndMs ?? 0) > (segment.videoStartMs ?? 0));
  const focusedLine = voiced.find(line => line.id === selectedLineId);
  const timedRows: TimedDubbingLine[] = voiced.map(line => ({
    id: line.id, text: line.text ?? line.label ?? line.id, videoStartMs: line.videoStartMs!, videoEndMs: line.videoEndMs!,
  }));
  const locks = director.locks ?? [];
  const isLocked = (line: EditorSegment) => locks.some(range => overlaps(range, { startMs: line.videoStartMs ?? 0, endMs: line.videoEndMs ?? 0 }));
  /** 卡片引用的全部会话素材。 */
  function mediaRefs() {
    return new Set<unknown>([
      editorData.videoRef, data.audioRef, data.directorBackgroundRef, voiceReferenceOf(data)?.audioRef,
      ...segments.map(segment => segment.audioRefOverride),
      ...(director.notes ?? []).flatMap(note => note.audioRefs),
    ]);
  }
  useEffect(() => {
    // 打开编辑器时从本机缓存自动恢复素材，刷新后不必重新选择文件。
    let cancelled = false;
    void media.restoreCached(mediaRefs()).then(count => {
      if (!cancelled && count) setToolStatus(`已从本机缓存恢复 ${count} 个素材。`);
    });
    return () => { cancelled = true; };
  }, []);
  /** 有配音记录但音频不在当前会话（刷新后未恢复）的句子。 */
  const audioOffline = (line: EditorSegment) => {
    const audio = segments.find(item => item.id === line.id);
    const ref = audio ? audio.audioRefOverride ?? (typeof data.audioRef === 'string' ? data.audioRef : null) : null;
    return Boolean(ref) && !media.resolve(ref!);
  };
  function applyEdit(changes: EditData) {
    try {
      assertUnlocked(editor.draftData() ?? {}, changes);
      editor.patch(changes);
      setToolStatus('');
      return true;
    } catch (error) {
      setToolStatus(error instanceof Error ? error.message : '编辑未应用');
      return false;
    }
  }

  useEffect(() => {
    if (!hasBackground && listenMode === 'background') setListenMode('voice');
  }, [hasBackground, listenMode]);
  useEffect(() => {
    setRanges([]);
    setSelectionTrack('original');
    setRangeDraft(null);
    setBoundaryDraft(null);
    setTrackGhost(null);
    rangeDrag.current = trackDrag.current = boundaryDrag.current = null;
  }, [videoUrl]);
  const selectedLineExists = !selectedLineId || trackLines.some(line => line.id === selectedLineId);
  useEffect(() => {
    if (!selectedLineExists) {
      setSelectedLineId(null);
      setTrackView('all');
    }
  }, [selectedLineExists]);

  const viewStart = trackView === 'focused' && focusedLine ? Math.max(0, (focusedLine.videoStartMs ?? 0) - 2000) : 0;
  const viewEnd = trackView === 'focused' && focusedLine ? Math.min(durationMs, (focusedLine.videoEndMs ?? 0) + 2000) : durationMs;
  const viewSpan = Math.max(1, viewEnd - viewStart);
  const cursorPercent = Math.max(0, Math.min(100, (previewMs - viewStart) / viewSpan * 100));
  const cursorVisible = previewMs >= viewStart && previewMs <= viewEnd;

  useEffect(() => {
    const button = Array.from(scriptList.current?.querySelectorAll<HTMLButtonElement>('button[data-script-line-id]') ?? [])
      .find(item => item.dataset.scriptLineId === selectedLineId);
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedLineId]);
  const selectTrackLine = (line: EditorSegment) => {
    setSelectedLineId(line.id);
    setSelectedTrack(null);
    playback.current?.seek(Math.max(0, line.videoStartMs ?? 0));
  };
  function cancelClipDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (trackDrag.current?.pointer !== event.pointerId) return;
    trackDrag.current = null;
    setTrackGhost(null);
  }
  function finishTrackDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = trackDrag.current;
    if (drag?.pointer !== event.pointerId) return;
    cancelClipDrag(event);
    if (Math.abs(event.clientX - drag.x) < 3 || !editorNode) return;
    drag.delta = (event.clientX - drag.x) / drag.width * drag.span;
    try {
      const next = changeRewriteWindow({ id: drag.line.id, text: drag.line.text ?? drag.line.label ?? '', videoStartMs: drag.line.videoStartMs!, videoEndMs: drag.line.videoEndMs! }, snapDelta(drag), drag.mode, durationMs);
      const window = { startMs: next.videoStartMs, endMs: next.videoEndMs };
      const current = editor.draftData() ?? {};
      let changes = drag.mode === 'move' ? rewriteWindows(current, { [next.id]: window }, durationMs)
        : trimClip(current, next.id, window, durationMs);
      if (drag.mode === 'move') {
        // 记下与上一句的间隔，之后自动贴合会保留这次手动摆放的位置。
        const previous = linesOf(current).filter(line => line.id !== next.id && line.videoEndMs <= next.videoStartMs).at(-1);
        if (previous) changes = { ...changes, ...setJoin(current, next.id, next.videoStartMs - previous.videoEndMs) };
      }
      if (applyEdit(changes)) setToolStatus(`区间更新为 ${displayTime(next.videoStartMs)} – ${displayTime(next.videoEndMs)}`);
    } catch (reason) { setToolStatus(reason instanceof Error ? reason.message : '区间调整失败'); }
  }
  function timeAt(clientX: number, rect: DOMRect) {
    return Math.round(viewStart + Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * viewSpan);
  }
  function toggleLineRange(line: EditorSegment) {
    const range = makeRange(line.videoStartMs!, line.videoEndMs!, durationMs);
    if (!range) return;
    const matches = (item: TimeRange) => item.startMs === range.startMs && item.endMs === range.endMs;
    setRanges(previous => previous.some(matches) ? previous.filter(item => !matches(item)) : [...previous, range]);
    setSelectionTrack('voice');
  }
  function cancelRangeDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (rangeDrag.current?.pointer !== event.pointerId) return;
    rangeDrag.current = null;
    setRangeDraft(null);
  }
  function startRangeDrag(event: React.PointerEvent<HTMLDivElement>, track: TimelineTrack) {
    if (!event.isPrimary || event.button !== 0 || !durationMs || trackDrag.current || rangeDrag.current || boundaryDrag.current) return;
    const clip = (event.target as Element).closest('[data-preview-line-id]');
    if (clip && !event.shiftKey) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    rangeDrag.current = {
      track, start: timeAt(event.clientX, rect), add: event.shiftKey, x: event.clientX, pointer: event.pointerId,
      line: clip ? voiced.find(line => line.id === clip.getAttribute('data-preview-line-id')) : undefined,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  const rangeHandlers = {
    onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
      const drag = rangeDrag.current;
      if (drag?.pointer !== event.pointerId) return;
      const end = timeAt(event.clientX, event.currentTarget.getBoundingClientRect());
      setRangeDraft(Math.abs(event.clientX - drag.x) >= 3 ? makeRange(drag.start, end, durationMs) : null);
    },
    onPointerUp(event: React.PointerEvent<HTMLDivElement>) {
      const drag = rangeDrag.current;
      if (drag?.pointer !== event.pointerId) return;
      cancelRangeDrag(event);
      const end = timeAt(event.clientX, event.currentTarget.getBoundingClientRect());
      const choice = Math.abs(event.clientX - drag.x) >= 3 ? makeRange(drag.start, end, durationMs) : null;
      if (choice) {
        setRanges(previous => drag.add ? [...previous, choice] : [choice]);
        setSelectionTrack(drag.track);
      } else if (drag.line) toggleLineRange(drag.line);
      else playback.current?.seek(end);
    },
    onPointerCancel: cancelRangeDrag,
    onLostPointerCapture: cancelRangeDrag,
  };
  function regionStyle(range: TimeRange) {
    return {
      left: `${Math.max(0, (range.startMs - viewStart) / viewSpan * 100)}%`,
      width: `${Math.max(0, Math.min(viewEnd, range.endMs) - Math.max(viewStart, range.startMs)) / viewSpan * 100}%`,
    };
  }
  function replaceRange(index: number, previousRange: TimeRange, updated: TimeRange) {
    setRanges(previous => previous[index] === previousRange
      ? previous.map((range, i) => i === index ? updated : range) : previous);
  }
  function dragBoundary(drag: BoundaryDrag, clientX: number) {
    const ms = drag.range[drag.edge] + (clientX - drag.x) / drag.width * viewSpan;
    return moveRangeBoundary(drag.range, drag.edge, Math.max(viewStart, Math.min(viewEnd, ms)), durationMs);
  }
  function cancelBoundaryDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (boundaryDrag.current?.pointer !== event.pointerId) return;
    boundaryDrag.current = null;
    setBoundaryDraft(null);
  }
  function boundaryHandle(range: TimeRange, index: number, edge: keyof TimeRange) {
    const value = range[edge];
    if (value < viewStart || value > viewEnd) return null;
    const start = edge === 'startMs';
    const position = (value - viewStart) / viewSpan * 100;
    const label = `选区 ${index + 1} ${start ? '起点' : '终点'}`;
    return <button key={`${index}-${edge}`} type="button" role="slider" className={styles.selectionHandle}
      style={{ left: `clamp(0px, calc(${position}% - ${start ? 10 : 2}px), calc(100% - 12px))` }}
      aria-label={label} aria-valuemin={start ? 0 : range.startMs + 1} aria-valuemax={start ? range.endMs - 1 : durationMs}
      aria-valuenow={value} aria-valuetext={displayTime(value)} title={`${label} ${displayTime(value)}`}
      onPointerDown={event => {
        event.stopPropagation();
        if (!event.isPrimary || event.button !== 0 || rangeDrag.current || trackDrag.current || boundaryDrag.current) return;
        const width = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 0;
        if (!width) return;
        boundaryDrag.current = { range: ranges[index]!, index, edge, pointer: event.pointerId, x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const drag = boundaryDrag.current;
        if (drag?.pointer === event.pointerId) setBoundaryDraft({ index: drag.index, range: dragBoundary(drag, event.clientX) });
      }}
      onPointerUp={event => {
        const drag = boundaryDrag.current;
        if (drag?.pointer !== event.pointerId) return;
        replaceRange(drag.index, drag.range, dragBoundary(drag, event.clientX));
        cancelBoundaryDrag(event);
      }}
      onPointerCancel={cancelBoundaryDrag} onLostPointerCapture={cancelBoundaryDrag}
      onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const step = event.shiftKey ? 1000 : 100;
        const ms = value + (event.key === 'ArrowLeft' ? -step : step);
        replaceRange(index, range, moveRangeBoundary(range, edge, ms, durationMs));
      }} />;
  }
  const currentRanges = boundaryDraft ? ranges.map((range, i) => i === boundaryDraft.index ? boundaryDraft.range : range) : ranges;
  const shownRanges = rangeDraft ? (rangeDrag.current?.add ? [...currentRanges, rangeDraft] : [rangeDraft]) : currentRanges;
  const visibleRanges = shownRanges.filter(range => range.endMs > viewStart && range.startMs < viewEnd);
  const visibleLocks = locks.filter(range => range.endMs > viewStart && range.startMs < viewEnd);
  const handleTrack = selectionTrack === 'background' && !hasBackground ? 'original' : selectionTrack;
  const trackOverlay = (track: TimelineTrack) => <>
    {visibleLocks.map((range, i) => <span className={styles.lockRange} style={regionStyle(range)} key={`lock-${i}`} />)}
    {visibleRanges.map((range, i) => <span className={styles.selectedRange} style={regionStyle(range)} key={`range-${i}`} />)}
    {cursorVisible && <span className={styles.trackCursor} style={{ left: `${cursorPercent}%` }} />}
    {track === handleTrack && !rangeDraft && currentRanges.flatMap((range, i) => [boundaryHandle(range, i, 'startMs'), boundaryHandle(range, i, 'endMs')])}
  </>;
  function snapDelta(drag: NonNullable<typeof trackDrag.current>) {
    const rawDelta = drag.delta;
    if (!snapping) return rawDelta;
    const anchor = drag.mode === 'end' ? drag.line.videoEndMs! : drag.line.videoStartMs!;
    const target = anchor + rawDelta;
    const marker = [...(director.markers ?? []), ...voiced.filter(line => line.id !== drag.line.id).flatMap(line => [{ ms: line.videoStartMs! }, { ms: line.videoEndMs! }])].reduce<{ ms: number } | null>((nearest, item) =>
      Math.abs(item.ms - target) < Math.abs((nearest?.ms ?? Infinity) - target) ? item : nearest, null);
    return marker && Math.abs(marker.ms - target) <= Math.min(350, 7 * drag.span / drag.width) ? marker.ms - anchor : rawDelta;
  }
  function clipCommand(command: 'split' | 'copy' | 'paste' | 'delete') {
    setClipMenu(null);
    if (projectBusy) return;
    try {
      const current = editor.draftData() ?? {};
      if (command === 'paste') {
        if (!clipboard || clipboard.project !== editorNode.id) throw new Error('请先复制当前工程里的片段。');
        const id = `line-${crypto.randomUUID()}`;
        const at = Math.round((previewVideo.current?.currentTime ?? 0) * 1000);
        if (applyEdit(pasteClip(current, clipboard.clip, at, id, durationMs))) { setSelectedLineId(id); setSelectedTrack(null); setToolStatus('已粘贴片段，其他声音的位置保持不变。'); }
        return;
      }
      if (!selectedLineId || selectedTrack) throw new Error('请先选择一句台词或配音片段。');
      if (command === 'copy') { setClipboard({ project: editorNode.id, clip: copyClip(current, selectedLineId) }); setToolStatus('已复制片段；将播放头移到空白区间后粘贴。'); }
      else if (command === 'delete') {
        if (applyEdit(deleteClip(current, selectedLineId, durationMs))) { setSelectedLineId(null); setToolStatus('片段已移除，原音频文件保留，可撤销。'); }
      } else {
        const line = trackLines.find(item => item.id === selectedLineId);
        const atMs = Math.round((previewVideo.current?.currentTime ?? 0) * 1000);
        if (!line || !(atMs > (line.videoStartMs ?? 0) && atMs < (line.videoEndMs ?? 0))) throw new Error('请先把播放头放在当前片段内部，再分割。');
        if (!segments.some(item => item.id === selectedLineId)) throw new Error('请先为本句导入或生成配音。');
        playback.current?.stop();
        setToolStatus('');
        setSplitRequest({ id: selectedLineId, atMs, text: line.text ?? line.label ?? '' });
      }
    } catch (error) { setToolStatus(error instanceof Error ? error.message : '片段操作失败'); }
  }
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.isComposing || event.altKey || !target.closest('[data-director-workbench]') || target.closest('input,textarea,select,[contenteditable="true"],[role="slider"],[role="separator"]')) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'c' && window.getSelection()?.toString()) return;
      if (event.code === 'Space' && target.closest('button') && !target.closest('[data-preview-line-id],[data-script-line-id]')) return;
      if (event.code === 'Space' && !mod) {
        event.preventDefault();
        if (projectBusy) return;
        if (previewVideo.current?.paused) void playback.current?.play(); else playback.current?.stop();
      } else if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); if (!projectBusy) editor.moveHistory(event.shiftKey ? 'redo' : 'undo'); }
      else if (mod && ['c', 'v'].includes(event.key.toLowerCase())) { event.preventDefault(); clipCommand(event.key.toLowerCase() === 'c' ? 'copy' : 'paste'); }
      else if (!mod && event.key.toLowerCase() === 's') { event.preventDefault(); clipCommand('split'); }
      else if (!mod && ['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); clipCommand('delete'); }
      else if (event.key === 'Escape') setClipMenu(null);
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });
  useEffect(() => {
    if (!followPlayhead || previewVideo.current?.paused || !timelineViewport.current) return;
    const viewport = timelineViewport.current;
    const x = cursorPercent / 100 * viewport.scrollWidth;
    if (x < viewport.scrollLeft || x > viewport.scrollLeft + viewport.clientWidth - 24) viewport.scrollLeft = Math.max(0, x - viewport.clientWidth * .25);
  }, [previewMs, cursorPercent, followPlayhead]);
  useEffect(() => {
    if (!clipMenu) return;
    const close = (event: PointerEvent) => { if (!(event.target as Element).closest('[data-clip-menu]')) setClipMenu(null); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [clipMenu]);
  const tickCount = Math.min(64, Math.max(4, Math.round(4 * trackZoom)));
  const zoomTouched = useRef(false);
  useEffect(() => {
    // 首次拿到视频时长时按长度选默认缩放；用户手动改过之后不再覆盖。
    if (zoomTouched.current || !durationMs || trackView === 'focused') return;
    setTrackZoom(defaultZoom(durationMs));
  }, [durationMs, trackView]);
  const pendingScroll = useRef<number | null>(null);
  useEffect(() => {
    const viewport = timelineViewport.current;
    if (viewport && pendingScroll.current !== null) { viewport.scrollLeft = pendingScroll.current; pendingScroll.current = null; }
  }, [trackZoom]);
  useEffect(() => {
    const viewport = timelineViewport.current;
    if (!viewport) return;
    // 滚轮在时间轴上横向滚动；⌘/Ctrl + 滚轮（触控板捏合）以指针位置为中心缩放。
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        setTrackZoom(current => {
          const index = ZOOMS.indexOf(current as typeof ZOOMS[number]);
          const next = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (index < 0 ? 0 : index) + (event.deltaY < 0 ? 1 : -1)))]!;
          if (next !== current) {
            zoomTouched.current = true;
            const offset = event.clientX - viewport.getBoundingClientRect().left;
            const ratio = viewport.scrollWidth ? (viewport.scrollLeft + offset) / viewport.scrollWidth : 0;
            pendingScroll.current = Math.max(0, ratio * viewport.clientWidth * next - offset);
          }
          return next;
        });
        return;
      }
      if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && viewport.scrollWidth > viewport.clientWidth) {
        event.preventDefault();
        viewport.scrollLeft += event.deltaY;
      }
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, [!editorData.videoRef && !trackLines.length]);
  function fitToVideo(extra: EditData = {}, quiet = false) {
    try {
      const current = { ...(editor.draftData() ?? {}), ...extra };
      const { changes, report } = fitTimeline(current, durationMs);
      if (applyEdit({ ...extra, ...changes })) setToolStatus(describeFit(report));
      return true;
    } catch (error) {
      if (!quiet) setToolStatus(error instanceof Error ? error.message : '贴合失败');
      return false;
    }
  }
  /** 配音音频或句间衔接变化时自动重新贴合；只看音频与衔接，不看窗口，避免和手动拖动互相覆盖。 */
  const fitSignature = JSON.stringify([segments.map(item => [item.id, item.audioRefOverride ?? null, item.startMs, item.endMs, item.gapMs]), joinsOf(data), rewriteLines.map(line => [line.id, line.text])]);
  const fittedSignature = useRef(fitSignature);
  useEffect(() => {
    if (fittedSignature.current === fitSignature) return;
    fittedSignature.current = fitSignature;
    if (autoFit && durationMs > 0 && segments.length && !projectBusy) fitToVideo({}, true);
  });
  function editJoin(value: number | null) {
    if (!selectedLineId) return;
    const change = setJoin(editor.draftData() ?? {}, selectedLineId, value);
    fittedSignature.current = JSON.stringify([segments.map(item => [item.id, item.audioRefOverride ?? null, item.startMs, item.endMs, item.gapMs]), (change.lineJoins as Record<string, number>), rewriteLines.map(line => [line.id, line.text])]);
    if (!fitToVideo(change)) applyEdit(change);
  }
  const chooseTrack = (track: TimelineTrack) => { setSelectedTrack(track); };
  const clipButtons = (labels: boolean) => <>
    <button className={styles.iconAction} aria-label="分割" title="在播放头分割 · S" disabled={!selectedLineId || !!selectedTrack || projectBusy} onClick={() => clipCommand('split')}><Scissors size={16} />{labels && '分割'}</button>
    <button className={styles.iconAction} aria-label="复制" title="复制片段 · ⌘/Ctrl C" disabled={!selectedLineId || !!selectedTrack || projectBusy} onClick={() => clipCommand('copy')}><Copy size={16} />{labels && '复制'}</button>
    <button className={styles.iconAction} aria-label="粘贴" title="粘贴到播放头 · ⌘/Ctrl V" disabled={!clipboard || clipboard.project !== editorNode.id || projectBusy} onClick={() => clipCommand('paste')}><ClipboardPaste size={16} />{labels && '粘贴'}</button>
    <button className={styles.iconAction} aria-label="删除" title="删除片段 · Delete" disabled={!selectedLineId || !!selectedTrack || projectBusy} onClick={() => clipCommand('delete')}><Trash2 size={16} />{labels && '删除'}</button>
  </>;
  const lineState = (line: EditorSegment): LineState => {
    const audio = segments.find(item => item.id === line.id);
    if (!audio) return 'missing';
    if (audio.startMs !== undefined && audio.endMs !== undefined && Number.isFinite(audio.videoStartMs) && Number.isFinite(audio.videoEndMs)
      && audio.endMs - audio.startMs > (audio.videoEndMs ?? 0) - (audio.videoStartMs ?? 0) + (audio.leadMs ?? 0) - (audio.gapMs ?? 0) + 1) return 'over';
    const timed = rewriteLines.find(item => item.id === line.id);
    return timed && !lineGenerationCurrent(data, line.id, timed.text) ? 'stale' : 'voiced';
  };
  const empty = !editorData.videoRef && !trackLines.length;
  const selectedIndex = trackLines.findIndex(line => line.id === selectedLineId);
  const progress = counts.total ? Math.round(counts.current / counts.total * 100) : 0;
  const offlineCount = trackLines.filter(audioOffline).length;
  const voiceReady = localVoiceAvailable();
  function importFiles(files: File[]) {
    const file = files[0];
    if (!file) return;
    if (file.type.startsWith('video/')) void handleImport('media', file);
    else if (file.type.startsWith('audio/')) void handleImport('voice', file);
    else if (file.type.startsWith('text/') || /\.(txt|md)$/iu.test(file.name)) void handleImport('script', file);
    else setToolStatus('请拖入视频、音频，或 TXT/MD 台词文件。');
  }
  const menuAction = (action: () => void) => () => { setMenuOpen(false); action(); };
  useEffect(() => {
    // Esc 只关闭最上层的浮层；阻止默认行为，避免连带关闭外层的编辑器对话框。
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const layer = confirmationAnswer.current ? 'confirm' : showExport ? 'export' : menuOpen ? 'menu' : clipMenu ? 'clip' : null;
      if (!layer) return;
      event.preventDefault();
      event.stopPropagation();
      if (layer === 'confirm') answerConfirmation(false);
      else if (layer === 'export') { if (!deliveryBusy) setShowExport(false); }
      else if (layer === 'menu') setMenuOpen(false);
      else setClipMenu(null);
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  });
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => { if (!(event.target as Element).closest('[data-workbench-menu]')) setMenuOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  return <main data-director-workbench className={styles.shell} data-theme={theme}
    onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
    onDrop={event => { if (!event.dataTransfer.files.length) return; event.preventDefault(); importFiles(Array.from(event.dataTransfer.files)); }}>
    <header className={styles.header}>
      <h1 className={styles.title}>DesignAI <span>音频工作台</span></h1>
      <span role="status" className={styles.toolStatus} data-save-state={editor.status.state} title={editor.status.message}>{editor.status.state === 'synced' && <Check size={13} />}{SAVE_LABEL[editor.status.state]}</span>
      {editor.status.state === 'unconfirmed' && <button type="button" className={styles.toolBtn} onClick={editor.retry}>重新提交</button>}
      <span className={styles.spacer} />
      <button type="button" className={styles.iconAction} aria-label="撤销" title="撤销 · ⌘/Ctrl Z" disabled={projectBusy || !editor.history.undo.length} onClick={() => editor.moveHistory('undo')}><Undo2 size={16} /></button>
      <button type="button" className={styles.iconAction} aria-label="重做" title="重做 · ⇧⌘/Ctrl Z" disabled={projectBusy || !editor.history.redo.length} onClick={() => editor.moveHistory('redo')}><Redo2 size={16} /></button>
      <button type="button" className={`${styles.toolBtn} ${styles.toolBtnPrimary}`} disabled={!editorNode || empty} onClick={() => { setToolStatus(''); setShowExport(true); }}><Download size={15} />导出</button>
      <div className={styles.menuWrap} data-workbench-menu>
        <button type="button" className={styles.iconAction} aria-label="更多操作" title="更多操作" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}><MoreHorizontal size={18} /></button>
        {menuOpen && <div role="menu" aria-label="更多操作" className={styles.menu}>
          <button type="button" role="menuitem" disabled={projectBusy} onClick={menuAction(() => mediaInput.current?.click())}>{editorData.videoRef ? '替换主视频' : '导入主视频'}</button>
          <button type="button" role="menuitem" disabled={projectBusy} onClick={menuAction(() => scriptInput.current?.click())}>导入台词</button>
          <button type="button" role="menuitem" disabled={projectBusy} onClick={menuAction(() => chooseVoice())}>导入整轨配音</button>
          <button type="button" role="menuitem" disabled={projectBusy} onClick={menuAction(() => backgroundInput.current?.click())}>{hasBackground ? '替换背景音乐' : '导入背景音乐'}</button>
          <button type="button" role="menuitem" disabled={projectBusy} onClick={menuAction(() => restoreInput.current?.click())}>恢复会话素材</button>
          {editorNode.projectFilePath && onOpenFile && <button type="button" role="menuitem" onClick={menuAction(() => onOpenFile(editorNode.projectFilePath!))}>打开画布主文件</button>}
          <hr />
          <button type="button" role="menuitem" onClick={menuAction(() => setShowShortcuts(value => !value))}>{showShortcuts ? '隐藏快捷键' : '快捷键'}</button>
          <button type="button" role="menuitem" onClick={menuAction(() => setTheme(theme === 'dark' ? 'light' : 'dark'))}>{theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}</button>
          <button type="button" role="menuitem" onClick={menuAction(() => setShowManual(true))}>使用帮助</button>
        </div>}
      </div>
      <button type="button" className={styles.iconAction} aria-label="返回画布" title="返回画布" onClick={onClose}><X size={18} /></button>
    </header>
    {showShortcuts && <div className={styles.shortcutBar}>空格 播放/暂停 · S 分割 · ⌘/Ctrl C/V 复制/粘贴 · Delete 删除 · ⌘/Ctrl Z 撤销</div>}
    <input ref={mediaInput} type="file" accept="video/*" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void handleImport('media', file); event.target.value = ''; }} />
    <input ref={voiceInput} type="file" accept="audio/*" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void handleImport('voice', file, voiceTarget.current); event.target.value = ''; }} />
    <input ref={backgroundInput} type="file" accept="audio/*" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void handleImport('background', file); event.target.value = ''; }} />
    <input ref={scriptInput} type="file" accept=".txt,.md,text/plain" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void handleImport('script', file); event.target.value = ''; }} />
    <input ref={restoreInput} type="file" accept="video/*,audio/*" multiple hidden onChange={event => { void restoreFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />

    {empty ? <section className={styles.onboarding} aria-label="开始编辑">
      <h2>开始一段短剧配音</h2>
      <p>把视频和台词文件拖到这里，或按下面的步骤导入。</p>
      <ol className={styles.steps}>
        <li><span className={styles.stepIcon}><Film size={20} /></span><div><strong>导入视频</strong><span>配音以视频时间为准</span></div>
          <button type="button" className={`${styles.toolBtn} ${styles.toolBtnPrimary}`} disabled={projectBusy} onClick={() => mediaInput.current?.click()}>导入视频</button></li>
        <li><span className={styles.stepIcon}><FileText size={20} /></span><div><strong>导入台词</strong><span>TXT 或 MD，每行一句</span></div>
          <button type="button" className={styles.toolBtn} disabled={projectBusy} onClick={() => scriptInput.current?.click()}>导入台词</button></li>
        <li><span className={styles.stepIcon}><AudioLines size={20} /></span><div><strong>生成或导入配音</strong><span>逐句生成，或导入整轨配音</span></div>
          <button type="button" className={styles.toolBtn} disabled={projectBusy} onClick={() => chooseVoice()}>导入整轨配音</button></li>
      </ol>
      {toolStatus && <div className={styles.notice} role="status">{toolStatus}</div>}
    </section> : <div className={styles.grid}>
      <aside className={styles.lineList} aria-label="台词列表">
        <div className={styles.listHeader}>
          <div className={styles.progressText}>{trackLines.length} 句 · 配音 {counts.current}/{counts.total} · 待确认 {Math.max(0, counts.total - counts.confirmed)}</div>
          <div className={styles.progressBar} aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
          <div className={styles.listActions}>
            <button type="button" className={styles.toolBtn} disabled={!voiceReady || projectBusy || (!counts.missing && !counts.stale && !offlineCount)}
              title={!voiceReady ? '本机配音需要在 127.0.0.1 打开并启动 VoxCPM' : counts.missing ? '为没有配音的句子逐句生成' : offlineCount ? '刷新后丢失音频的句子重新生成' : '重新生成文字或音色已变化的句子'}
              onClick={() => void generateVoice(counts.missing ? 'missing' : offlineCount ? 'offline' : counts.stale ? 'stale' : 'missing')}><Sparkles size={14} />{generating ? '生成中…' : counts.missing ? '补齐缺失配音' : offlineCount ? `重新生成未载入的 ${offlineCount} 句` : counts.stale ? `更新 ${counts.stale} 句配音` : '补齐缺失配音'}</button>
            {generating && <button type="button" className={styles.toolBtn} onClick={() => { generateController.current?.abort(); setToolStatus('已请求停止；已生成音频保留'); }}>停止</button>}
          </div>
        </div>
        <div ref={scriptList} className={styles.lineRows}>
          {trackLines.map((line, index) => {
            const state = lineState(line);
            const isConfirmed = editorData.confirmedLineIds?.includes(line.id) ?? false;
            const offline = audioOffline(line);
            return <button type="button" className={styles.lineRow} key={line.id} data-script-line-id={line.id} data-offline={offline}
              aria-pressed={!selectedTrack && selectedLineId === line.id} onClick={() => selectTrackLine(line)}>
              <span className={styles.lineDot} data-state={state} title={offline ? `${LINE_STATE_LABEL[state]} · 音频未载入，需重新生成或恢复` : LINE_STATE_LABEL[state]} />
              <span className={styles.lineNumber}>{String(index + 1).padStart(2, '0')}</span>
              <span className={styles.lineText} title={line.text ?? line.label ?? ''}>{line.text ?? line.label ?? '未填写台词'}</span>
              <span className={styles.lineStatus} data-confirmed={isConfirmed} title={isConfirmed ? '已确认' : '待确认'}>{isConfirmed && <Check size={13} />}</span>
            </button>;
          })}
          {!trackLines.length && <div className={styles.editorEmpty}><p>还没有台词。</p><button type="button" className={styles.toolBtn} onClick={() => scriptInput.current?.click()}>导入台词</button></div>}
        </div>
        <RewritePanel data={data} read={editor.draftData} patch={applyEdit} mediaUrl={media.resolve} disabled={projectBusy} ask={ask} />
      </aside>
      <section className={styles.stage} aria-label="视频与时间轴">
        <div className={styles.videoFrame}>
          {videoUrl
            ? <video ref={previewVideo} className={styles.previewVideo} style={{ aspectRatio: `${videoSize.width} / ${videoSize.height}` }}
                src={videoUrl} controls preload="metadata" muted={!originalAudio} playsInline onLoadedMetadata={event => {
                  const video = event.currentTarget;
                  setVideoSize({ width: video.videoWidth || 16, height: video.videoHeight || 9, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0 });
                }} />
            : <div className={styles.videoPlaceholder} role="status">
                <Film size={28} />
                {editorData.videoRef
                  ? <><p>刷新后需要重新选择原视频</p><button type="button" className={`${styles.toolBtn} ${styles.toolBtnPrimary}`} disabled={projectBusy} onClick={() => restoreInput.current?.click()}>选择原文件恢复</button></>
                  : <><p>暂无视频</p><button type="button" className={styles.toolBtn} disabled={projectBusy} onClick={() => mediaInput.current?.click()}>导入视频</button></>}
              </div>}
        </div>
        {editorNode && <DirectorTools variant="playback" clock={`${shortTime(previewMs)} / ${shortTime(durationMs)}`} key={`${editorNode.id}-playback`} data={data} mediaUrl={media.resolve} rows={timedRows} duration={durationMs}
          time={() => Math.round((previewVideo.current?.currentTime ?? 0) * 1000)} selectedId={selectedLineId}
          select={id => { const line = voiced.find(item => item.id === id); if (line) selectTrackLine(line); }}
          ranges={ranges} setRanges={setRanges} playback={playback} mode={listenMode} setMode={setListenMode}
          disabled={projectBusy} patch={applyEdit} />}
        <div className={styles.timelinePanel}>
          <div className={styles.timelineToolbar}>
            {clipButtons(false)}
            <span className={styles.toolDivider} />
            <button type="button" className={styles.iconAction} aria-label="吸附" aria-pressed={snapping} title="吸附片段边界和标记" onClick={() => setSnapping(value => !value)}><Magnet size={16} /></button>
            <span className={styles.toolDivider} />
            <button type="button" className={styles.fitButton} disabled={projectBusy || !durationMs || !trackLines.length} title="按配音时长连贯排布，贴合视频时长" onClick={() => fitToVideo()}><AlignHorizontal size={15} />贴合视频</button>
            <button type="button" className={styles.chip} aria-pressed={autoFit} title="配音变化后自动重新贴合" onClick={() => setAutoFit(value => !value)}>自动</button>
            <span className={styles.spacer} />
            <button type="button" className={styles.iconAction} aria-label={trackView === 'focused' ? '全片概览' : '当前句放大'} title={trackView === 'focused' ? '回到全片概览' : '放大当前句'} aria-pressed={trackView === 'focused'} disabled={!selectedLineId && trackView !== 'focused'}
              onClick={() => { setTrackView(view => view === 'focused' ? 'all' : 'focused'); setTrackZoom(1); }}><Scan size={16} /></button>
            <button type="button" className={styles.iconAction} aria-label="跟随播放" title="播放时时间轴跟随播放头" aria-pressed={followPlayhead} onClick={() => setFollowPlayhead(value => !value)}><LocateFixed size={16} /></button>
            <select className={styles.zoomSelect} aria-label="音轨缩放" title="音轨缩放 · ⌘/Ctrl + 滚轮" value={trackZoom} onChange={event => { zoomTouched.current = true; setTrackZoom(Number(event.target.value)); }}>{ZOOMS.map(zoom => <option key={zoom} value={zoom}>{zoom}×</option>)}</select>
          </div>
              <div className={styles.timelineViewport} ref={timelineViewport}>
              <div style={{ width: `${trackZoom * 100}%` }}>
              <div className={styles.trackRow}>
                <span className={styles.trackLabel} />
                <div className={styles.timelineTicks} aria-label="时间刻度" onPointerDown={event => startRangeDrag(event, 'original')} {...rangeHandlers}>
                  {cursorVisible && <span aria-hidden="true" className={styles.rulerCursor} style={{ left: `${cursorPercent}%` }} />}
                  {Array.from({ length: tickCount + 1 }, (_, tick) => {
                    const ms = viewStart + viewSpan * tick / tickCount;
                    return <span key={tick}>{viewSpan / tickCount < 1000 ? `${(ms / 1000).toFixed(1)}s` : shortTime(ms)}</span>;
                  })}
                </div>
              </div>
              <div className={styles.trackRow}>
                <button className={styles.trackLabel} aria-label="视频 / 原声" title="原声音轨属性" aria-pressed={selectedTrack === 'original'} onClick={() => chooseTrack('original')}>原声</button>
                <div className={styles.trackBase} title="视频与原声共用主时钟" onPointerDown={event => startRangeDrag(event, 'original')} {...rangeHandlers}>
                  <div className={`${styles.trackSeg} ${styles.trackOriginal}`} style={{ left: 0, width: '100%' }}><Waveform readPeaks={readPeaks} mediaUrl={media.resolve} audioRef={editorData.videoRef} offsetMs={viewStart} spanMs={viewSpan} gain={Number(data.directorOriginalGain ?? 1)} /></div>
                  {trackOverlay('original')}
                  {(director.markers ?? []).filter(marker => marker.ms >= viewStart && marker.ms <= viewEnd).map(marker => <button key={marker.id} type="button"
                    className={styles.marker} style={{ left: `${(marker.ms - viewStart) / viewSpan * 100}%` }} title={marker.label} aria-label={`跳到 ${marker.label}`}
                    onPointerDown={event => event.stopPropagation()}
                    onClick={() => playback.current?.seek(marker.ms)} />)}
                </div>
              </div>
              <div className={styles.trackRow}>
                <button className={styles.trackLabel} aria-label="配音音轨" title="配音音轨属性" aria-pressed={selectedTrack === 'voice'} onClick={() => chooseTrack('voice')}>配音</button>
                <div className={styles.trackBase} title={`配音区间 ${voiced.length} 句`} onPointerDown={event => startRangeDrag(event, 'voice')} {...rangeHandlers}>
                  {durationMs > 0 && voiced.filter(line => (line.videoEndMs ?? 0) > viewStart && (line.videoStartMs ?? 0) < viewEnd).map(segment => {
                    const shown = trackGhost?.id === segment.id ? trackGhost : segment;
                    const audio = segments.find(item => item.id === segment.id);
                    const lead = trackGhost?.id === segment.id ? 0 : Math.max(0, audio?.leadMs ?? 0);
                    const clipStart = (shown.videoStartMs ?? 0) - lead;
                    const start = Math.max(0, (Math.max(viewStart, clipStart) - viewStart) / viewSpan * 100);
                    const width = Math.max(0, (Math.min(viewEnd, shown.videoEndMs ?? 0) - Math.max(viewStart, clipStart)) / viewSpan * 100);
                    const visibleOffset = Math.max(0, viewStart - (shown.videoStartMs ?? 0));
                    const waveSpan = Math.min(viewEnd, shown.videoEndMs ?? 0) - Math.max(viewStart, shown.videoStartMs ?? 0);
                    const locked = isLocked(segment);
                    const status = !selectedTrack && selectedLineId === segment.id ? 'editing' : editorData.confirmedLineIds?.includes(segment.id) ? 'complete' : 'pending';
                    return <button type="button" key={segment.id} data-preview-line-id={segment.id} data-edit-status={status} data-locked={locked}
                      className={`${styles.trackSeg} ${status === 'editing' ? styles.trackEditing : status === 'complete' ? styles.trackComplete : styles.trackPending}`}
                      style={{ left: `${start}%`, width: `${width}%` }} title={locked ? '已锁定 · ' + (segment.text ?? segment.label ?? segment.id) : segment.text ?? segment.label ?? segment.id}
                      onContextMenu={event => { event.preventDefault(); selectTrackLine(segment); playback.current?.seek(timeAt(event.clientX, event.currentTarget.parentElement!.getBoundingClientRect())); setClipMenu({ x: Math.min(event.clientX, window.innerWidth - 180), y: Math.min(event.clientY, window.innerHeight - 200) }); }}
                      aria-label={`编辑配音 ${segment.id}`} onPointerDown={event => {
                        if (event.shiftKey) return;
                        event.stopPropagation();
                        if (event.button !== 0 || !event.isPrimary || projectBusy || locked || rangeDrag.current) return;
                        const rect = event.currentTarget.getBoundingClientRect();
                        const offset = event.clientX - rect.left;
                        const mode = rect.width > 24 && offset < 8 ? 'start' : rect.width > 24 && offset > rect.width - 8 ? 'end' : 'move';
                        trackDrag.current = { line: segment, x: event.clientX, pointer: event.pointerId, width: event.currentTarget.parentElement!.getBoundingClientRect().width, span: viewSpan, mode, delta: 0 };
                        event.currentTarget.setPointerCapture(event.pointerId);
                        selectTrackLine(segment);
                      }} onPointerMove={event => {
                        const drag = trackDrag.current;
                        if (drag?.pointer !== event.pointerId) return;
                        drag.delta = (event.clientX - drag.x) / drag.width * drag.span;
                        setTrackGhost(Math.abs(event.clientX - drag.x) >= 3 ? changeRewriteWindow({
                          id: drag.line.id, text: drag.line.text ?? drag.line.label ?? '',
                          videoStartMs: drag.line.videoStartMs!, videoEndMs: drag.line.videoEndMs!,
                        }, snapDelta(drag), drag.mode, durationMs) : null);
                      }} onPointerUp={finishTrackDrag} onPointerCancel={cancelClipDrag} onLostPointerCapture={cancelClipDrag}
                      onClick={event => {
                        event.stopPropagation();
                        if (event.shiftKey) {
                          if (event.detail === 0) toggleLineRange(segment);
                        } else if (event.detail === 0 || locked || projectBusy) selectTrackLine(segment);
                      }}>{lead > 0 && <span className={styles.overlapMark} title={`与上一句重叠 ${lead} ms`} style={{ width: `${Math.min(100, lead / Math.max(1, (shown.videoEndMs ?? 0) - clipStart) * 100)}%` }} />}<span className={styles.clipName}>{locked ? '锁定 · ' : ''}{segment.text ?? segment.label ?? segment.id}</span><Waveform readPeaks={readPeaks} mediaUrl={media.resolve} audioRef={audio ? audio.audioRefOverride ?? data.audioRef as string : undefined} offsetMs={(audio?.startMs ?? 0) + visibleOffset} spanMs={waveSpan} playableMs={Math.max(0, Math.min((audio?.endMs ?? 0) - (audio?.startMs ?? 0), (shown.videoEndMs ?? 0) - (shown.videoStartMs ?? 0) - (audio?.gapMs ?? 0)) - visibleOffset)} gain={Number(data.masterGain ?? 1) * (audio?.gain ?? 1)} /></button>;
                  })}
                  {trackOverlay('voice')}
                </div>
              </div>
              {hasBackground && <div className={styles.trackRow}>
                <button className={styles.trackLabel} aria-label="背景音乐" title="背景音乐音轨属性" aria-pressed={selectedTrack === 'background'} onClick={() => chooseTrack('background')}>音乐</button>
                <div className={styles.trackBase} title="背景音乐音轨" onPointerDown={event => startRangeDrag(event, 'background')} {...rangeHandlers}>
                  <div className={`${styles.trackSeg} ${styles.trackBackground}`} style={regionStyle({ startMs: 0, endMs: backgroundEnd })}><Waveform readPeaks={readPeaks} mediaUrl={media.resolve} audioRef={data.directorBackgroundRef as string} offsetMs={viewStart} spanMs={Math.min(viewEnd, backgroundEnd) - viewStart} gain={Number(data.directorBackgroundGain ?? 1)} /></div>
                  {trackOverlay('background')}
                </div>
              </div>}
              </div>
              </div>
          {(shownRanges.length > 0 || trackGhost) && <div className={styles.timelineFooter}>
            {shownRanges.length > 0 && <span className={styles.selectionHint}>{shownRanges.length === 1
              ? `选区 ${shortTime(shownRanges[0]!.startMs)}–${shortTime(shownRanges[0]!.endMs)}` : `已选 ${shownRanges.length} 段`}</span>}
            {trackGhost && <span role="status">{shortTime(trackGhost.videoStartMs ?? 0)}–{shortTime(trackGhost.videoEndMs ?? 0)}</span>}
          </div>}
        </div>
        {toolStatus && <div className={styles.notice} role="status">{toolStatus}</div>}
      </section>
      <aside className={styles.inspector} aria-label="内容编辑">
        <div className={styles.inspectorBody}>
          {selectedTrack && <TrackInspector track={selectedTrack} data={data} disabled={projectBusy} mode={listenMode} setMode={setListenMode} patch={applyEdit} />}
          {!selectedLineId && !selectedTrack && <div className={styles.emptyInspector}>
            <h2>选一句开始编辑</h2>
            <p>在左侧点一句台词，或点时间轴上的片段，就能修改台词、音色和音量。</p>
            <button type="button" className={`${styles.toolBtn} ${styles.toolBtnPrimary}`} disabled={!trackLines.length} onClick={() => selectTrackLine(trackLines[0]!)}>编辑第一句</button>
          </div>}
          <div hidden={!selectedLineId || Boolean(selectedTrack)}>
            <div className={styles.selectionTitle}>
              <h2>第 {selectedIndex + 1} 句</h2>
              {focusedLine && <span>{shortTime(focusedLine.videoStartMs ?? 0)}–{shortTime(focusedLine.videoEndMs ?? 0)}</span>}
              <span className={styles.spacer} />
              <button type="button" className={styles.iconAction} aria-label="上一句" title="上一句" disabled={selectedIndex <= 0} onClick={() => selectTrackLine(trackLines[selectedIndex - 1]!)}><ChevronLeft size={16} /></button>
              <button type="button" className={styles.iconAction} aria-label="下一句" title="下一句" disabled={selectedIndex < 0 || selectedIndex >= trackLines.length - 1} onClick={() => selectTrackLine(trackLines[selectedIndex + 1]!)}><ChevronRight size={16} /></button>
              {selectedLineId && linesOf(editorNode?.data ?? {}).some(line => line.id === selectedLineId) && <button type="button" className={styles.iconAction} aria-label="替换本句音频" title="用本地音频替换这一句" disabled={projectBusy} onClick={() => chooseVoice(selectedLineId)}><Upload size={15} /></button>}
            </div>
            {selectedIndex > 0 && focusedLine && (() => {
              const previous = trackLines[selectedIndex - 1]!;
              const lead = Math.max(0, segments.find(item => item.id === selectedLineId)?.leadMs ?? 0);
              const join = lead ? -lead : (focusedLine.videoStartMs ?? 0) - (previous.videoEndMs ?? 0);
              const manual = joinsOf(data)[selectedLineId!] !== undefined;
              return <div className={styles.joinRow}>
                <span>与上一句</span>
                <JoinField key={`${selectedLineId}-${join}`} value={join} onCommit={editJoin} />
                <span className={styles.joinHint}>{join < 0 ? '重叠' : '空白'}</span>
                <button type="button" className={styles.linkBtn} disabled={!manual || projectBusy} title="恢复自动间隔" onClick={() => editJoin(null)}>{manual ? '恢复自动' : '自动'}</button>
              </div>;
            })()}
            {editorNode && <div className={styles.editorScroll}><DubbingEditor key={editorNode.id} node={editorNode} selected
              externalVideoRef={previewVideo} selectedLineId={selectedLineId}
              onLineSelect={id => {
                setSelectedLineId(id);
                setSelectedTrack(null);
                const line = voiced.find(item => item.id === id);
                if (line) playback.current?.seek(Math.max(0, line.videoStartMs ?? 0));
              }}
              sessionMedia={{ readData: editor.draftData, resolve: media.resolve, add: media.add }}
              onGenerationChange={setLineGenerating} batchGenerating={generating || mediaBusy || deliveryBusy}
              playback={playback} listenMode={listenMode}
              guardPatch={next => assertUnlocked(editor.draftData() ?? {}, next)}
              onPatch={patch => { if (patch.data) editor.patch(patch.data); }} /></div>}
          </div>
        </div>
        {editorNode && <DirectorTools key={editorNode.id} data={data} mediaUrl={media.resolve} rows={timedRows} duration={durationMs}
          time={() => Math.round((previewVideo.current?.currentTime ?? 0) * 1000)} selectedId={selectedLineId}
          select={id => { const line = voiced.find(item => item.id === id); if (line) selectTrackLine(line); }}
          ranges={ranges} setRanges={setRanges} playback={playback} mode={listenMode} setMode={setListenMode}
          disabled={projectBusy} patch={applyEdit} />}
      </aside>
    </div>}
    {confirmation && <div role="alertdialog" aria-label="确认当前操作" className={styles.confirmBar}>
      <span>{confirmation.message}</span>
      <button type="button" className={styles.toolBtn} autoFocus onClick={() => answerConfirmation(false)}>取消</button>
      <button type="button" className={`${styles.toolBtn} ${styles.toolBtnPrimary}`} onClick={() => answerConfirmation(true)}>{confirmation.label}</button>
    </div>}
    {showExport && <div className={styles.overlay} onPointerDown={event => { if (event.target === event.currentTarget && !deliveryBusy) setShowExport(false); }}>
      <section role="dialog" aria-label="导出成品" className={styles.exportDialog}>
        <div className={styles.dialogHeader}>
          <h2>导出成品</h2>
          <button type="button" className={styles.iconAction} aria-label="关闭导出" disabled={deliveryBusy} onClick={() => setShowExport(false)}><X size={18} /></button>
        </div>
        {checking.length
          ? <div className={styles.checkBox}><strong>导出前请留意</strong><ul className={styles.checkList}>{checking.map(issue => <li key={issue}>{issue}</li>)}</ul><span>仍可导出，文件会使用当前采用的配音和区间。</span></div>
          : <p className={styles.checkOk}><Check size={14} />检查未发现问题</p>}
        <div className={styles.exportGrid}>
          <button type="button" className={styles.exportOption} aria-label="导出 WAV" disabled={!editorNode || projectBusy || !segments.length && !originalAudio && !hasBackground} onClick={() => void deliver('wav')}><strong>导出 WAV</strong><span>{listenLabel[listenMode]}音轨</span></button>
          <button type="button" className={styles.exportOption} aria-label="导出台词 SRT" disabled={!counts.total || projectBusy} onClick={() => void deliver('srt')}><strong>导出台词 SRT</strong><span>逐句字幕</span></button>
          <button type="button" className={styles.exportOption} aria-label={ranges.length === 1 ? '导出选区 MP4' : '导出全片 MP4'} disabled={!videoUrl || projectBusy || !durationMs} onClick={() => void deliver('mp4')}><strong>{ranges.length === 1 ? '导出选区 MP4' : '导出全片 MP4'}</strong><span>画面加当前音轨</span></button>
          <button type="button" className={styles.exportOption} aria-label="下载剪辑交接包" disabled={!editorNode || projectBusy || !durationMs} onClick={() => void deliver('zip')}><strong>下载剪辑交接包</strong><span>素材加项目清单</span></button>
        </div>
        <label className={styles.checkboxRow}><input type="checkbox" checked={burnCaptions} onChange={event => setBurnCaptions(event.target.checked)} />在 MP4 画面中显示字幕</label>
        {deliveryBusy && <button type="button" className={styles.toolBtn} onClick={() => { exportController.current?.abort(); answerConfirmation(false); }}>取消导出</button>}
        {toolStatus && <p className={styles.dialogStatus} role="status">{toolStatus}</p>}
      </section>
    </div>}
    {showManual && <ManualDialog onClose={() => setShowManual(false)} />}
    {clipMenu && <div data-clip-menu className={styles.clipMenu} style={{ left: clipMenu.x, top: clipMenu.y }} aria-label="片段操作">{clipButtons(true)}</div>}
    {splitRequest && <SplitClipDialog error={toolStatus} text={splitRequest.text} atMs={splitRequest.atMs} onCancel={() => setSplitRequest(null)} onSplit={boundary => {
      try {
        const id = `line-${crypto.randomUUID()}`;
        if (!applyEdit(splitClip(editor.draftData() ?? {}, splitRequest.id, splitRequest.atMs, boundary, id, durationMs))) return false;
        setSplitRequest(null); setSelectedLineId(id); setToolStatus('配音已分为两段，原音频保留；请试听确认分句位置。');
        return true;
      } catch (error) { setToolStatus(error instanceof Error ? error.message : '分割失败'); return false; }
    }} />}
  </main>;
}

/** 与上一句的衔接：正数是空白、负数是重叠（毫秒），失焦或回车后提交。 */
function JoinField({ value, onCommit }: { value: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(Math.round(value)));
  const commit = () => {
    const next = Number(draft);
    if (!draft.trim() || !Number.isFinite(next)) { setDraft(String(Math.round(value))); return; }
    if (Math.round(next) !== Math.round(value)) onCommit(Math.max(-LAYOUT.maxOverlapMs, Math.min(LAYOUT.maxJoinMs, Math.round(next))));
  };
  return <span className={styles.joinField}>
    <input aria-label="与上一句的间隔（毫秒）" type="number" step={50} min={-LAYOUT.maxOverlapMs} max={LAYOUT.maxJoinMs} value={draft}
      onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
    <span>ms</span>
  </span>;
}
