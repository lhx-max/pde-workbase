'use client';

import { Copy, Scissors, ClipboardPaste, Trash2, Magnet, Undo2, Redo2, FolderOpen, PanelLeftClose, PanelLeftOpen, BookOpen, X } from './icons';
import type { CSSProperties } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CardRenderProps } from '@bezier/canvas-card-sdk';
import { DubbingEditor, type DubbingPlayback } from '../dubbing-editor';
import { changeRewriteWindow, validateRewriteLines, type RewriteLine as TimedDubbingLine } from '../rewrite';
import { dubbingCounts } from '../dubbing';
import { resolvePlaybackDuration } from '../playback-plan';
import { assertMediaSize, type useSessionMedia } from './media';
import { fillMissing, localVoiceAvailable } from './local-voice';
import { exportHandoff, exportVideo } from './director-delivery';
import { createPeakReader, Waveform } from './waveform';
import { useWorkbenchLayout } from './use-workbench-layout';
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
import { audioDurationOf, deliveryIssues, download, exportSubtitles, exportWav, importScript, importVoice, linesOf, videoDurationOf } from './director-media';
import styles from './workbench.module.css';

/** 音频编辑工作台：视频与时间轴并排，选中内容在右侧编辑。 */

interface EditorSegment { startMs?: number; endMs?: number; gapMs?: number; gain?: number; audioRefOverride?: string | null; id: string; text?: string; label?: string; muted?: boolean; videoStartMs?: number | null; videoEndMs?: number | null }
type TimelineTrack = 'original' | 'voice' | 'background';
type BoundaryDrag = { range: TimeRange; index: number; edge: keyof TimeRange; pointer: number; x: number; width: number };

export function Workbench({ node: editorNode, onPatch, onOpenFile, media, onClose }: CardRenderProps & {
  media: ReturnType<typeof useSessionMedia>;
  onClose: () => void;
}) {
  const workspace = useWorkbenchLayout();
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
  const [drawer, setDrawer] = useState(true);
  const scriptList = useRef<HTMLDivElement>(null);
  const [inspectorTab, setInspectorTab] = useState<'content' | 'check' | 'export'>('content');
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
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
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

  async function generateVoice() {
    if (!localVoiceAvailable() || generateController.current || lineGenerating || mediaBusy || deliveryBusy) return;
    const controller = new AbortController();
    generateController.current = controller;
    setGenerating(true);
    setToolStatus('正在补齐缺失配音…');
    try {
      await fillMissing(editor.draftData, applyEdit, media.add, controller.signal, setToolStatus);
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
      const issues = deliveryIssues(data, durationMs);
      if (issues.length && !await ask(`导出前检查：${issues.join('、')}。文件将使用当前应用的配音和区间。`, '继续导出')) return;
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
      const refs = new Set([
        editorData.videoRef, data.audioRef, data.directorBackgroundRef,
        ...segments.map(segment => segment.audioRefOverride),
        ...(director.notes ?? []).flatMap(note => note.audioRefs),
      ]);
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

  function focusScript() {
    const buttons = Array.from(scriptList.current?.querySelectorAll<HTMLButtonElement>('button[data-script-line-id]') ?? []);
    const target = buttons.find(button => button.dataset.scriptLineId === selectedLineId) ?? buttons[0];
    target?.focus();
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  useEffect(() => {
    const button = Array.from(scriptList.current?.querySelectorAll<HTMLButtonElement>('button[data-script-line-id]') ?? [])
      .find(item => item.dataset.scriptLineId === selectedLineId);
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedLineId]);
  const selectTrackLine = (line: EditorSegment) => {
    setSelectedLineId(line.id);
    setSelectedTrack(null);
    setInspectorTab('content');
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
      const changes = drag.mode === 'move' ? rewriteWindows(editor.draftData() ?? {}, { [next.id]: window }, durationMs)
        : trimClip(editor.draftData() ?? {}, next.id, window, durationMs);
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
  const chooseTrack = (track: TimelineTrack) => { setSelectedTrack(track); setInspectorTab('content'); };
  const clipActions = <>
    <button className={styles.iconAction} title="在播放头分割 · S" disabled={!selectedLineId || !!selectedTrack || projectBusy} onClick={() => clipCommand('split')}><Scissors size={15} />分割</button>
    <button className={styles.iconAction} title="复制片段 · ⌘/Ctrl C" disabled={!selectedLineId || !!selectedTrack || projectBusy} onClick={() => clipCommand('copy')}><Copy size={15} />复制</button>
    <button className={styles.iconAction} title="粘贴到播放头 · ⌘/Ctrl V" disabled={!clipboard || clipboard.project !== editorNode.id || projectBusy} onClick={() => clipCommand('paste')}><ClipboardPaste size={15} />粘贴</button>
    <button className={styles.iconAction} title="删除片段 · Delete" disabled={!selectedLineId || !!selectedTrack || projectBusy} onClick={() => clipCommand('delete')}><Trash2 size={15} />删除</button>
  </>;
  return <main data-director-workbench className={styles.shell} data-theme={theme} style={{ '--sidebar-width': `${workspace.layout.left}px`, '--inspector-width': `${workspace.layout.right}px`, '--timeline-height': `${workspace.layout.timeline}px`, '--track-height': `${workspace.layout.trackHeight}px` } as CSSProperties}>
    <header className={styles.header}>
      <span className={styles.brandDot} />
      <h1 className={styles.title}>DesignAI <span>音频工作台</span></h1>
        <div className={styles.toolbar} aria-label="保存和撤销">
          <button type="button" className={styles.toolBtn} disabled={projectBusy || !editor.history.undo.length} onClick={() => editor.moveHistory('undo')}><Undo2 size={14} />撤销</button>
          <button type="button" className={styles.toolBtn} disabled={projectBusy || !editor.history.redo.length} onClick={() => editor.moveHistory('redo')}><Redo2 size={14} />重做</button>
          <span role="status" className={styles.toolStatus} data-save-state={editor.status.state} title={editor.status.message}>{editor.status.message}</span>
          {editor.status.state === 'unconfirmed' && <button type="button" className={styles.toolBtn} onClick={editor.retry}>重新提交</button>}
        </div>
      <button type="button" className={styles.toolBtn} aria-pressed={inspectorTab === 'check'} onClick={() => { setInspectorTab('check'); }}>检查{checking.length ? ` · ${checking.length}` : ''}</button>
      <button type="button" className={`${styles.toolBtn} ${styles.toolBtnPrimary}`} onClick={() => { setInspectorTab('export'); }}>导出</button>
      <button type="button" className={styles.toolBtn} aria-haspopup="dialog" onClick={() => setShowManual(true)}><BookOpen size={14} aria-hidden />使用帮助</button>
      <button type="button" className={`${styles.toolBtn} ${styles.themeButton}`} aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'} onClick={() => {
        const next = theme === 'dark' ? 'light' : 'dark';
        setTheme(next);
      }}>{theme === 'dark' ? '☀ 浅色' : '☾ 深色'}</button>
      <button type="button" className={styles.toolBtn} aria-label="返回画布" onClick={onClose}><X size={16} />返回画布</button>
    </header>
    <nav className={styles.workspaceNav} aria-label="工作台入口">
      <div className={styles.workspaceModes} role="group" aria-label="工作区布局"><span>工作区</span><button onClick={() => workspace.preset('script')}>台词精修</button><button onClick={() => workspace.preset('audio')}>音频剪辑</button><button onClick={() => { workspace.preset('mix'); chooseTrack('voice'); }}>混音检查</button><button onClick={workspace.reset}>重置布局</button><button onClick={() => setShowShortcuts(value => !value)} aria-expanded={showShortcuts}>快捷键</button></div>
      <p className={styles.panelHint}>选一句 → 修改内容与声音 → 试听确认 → 导出</p>
    </nav>
          <input ref={mediaInput} type="file" accept="video/*" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void handleImport('media', file); event.target.value = ''; }} />
          <input ref={voiceInput} type="file" accept="audio/*" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void handleImport('voice', file, voiceTarget.current); event.target.value = ''; }} />
          <input ref={backgroundInput} type="file" accept="audio/*" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void handleImport('background', file); event.target.value = ''; }} />
          <input ref={scriptInput} type="file" accept=".txt,.md,text/plain" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void handleImport('script', file); event.target.value = ''; }} />

    <input ref={restoreInput} type="file" accept="video/*,audio/*" multiple hidden onChange={event => { void restoreFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    {showShortcuts && <div className={styles.shortcutBar}>空格 播放/暂停 · S 分割 · ⌘/Ctrl C/V 复制/粘贴 · Delete 删除 · ⌘/Ctrl Z 撤销 · 双击分隔线恢复默认尺寸</div>}
    <div className={styles.grid} ref={workspace.grid}>
      <aside id="workbench-drawer" className={drawer ? styles.drawer : styles.sideRail} aria-label="素材侧栏"
        onKeyDown={event => { if (event.key === 'Escape') setDrawer(false); }}>
        {drawer ? <>
          <div className={styles.panelHeader}><h2 className={styles.panelTitle}>素材</h2>
            <button type="button" className={styles.sideIcon} aria-label="收起左侧栏" title="收起左侧栏" onClick={() => setDrawer(false)}><PanelLeftClose size={18} /></button>
          </div>
        </> : <>
          <button type="button" className={styles.sideIcon} aria-label="展开左侧栏" title="展开左侧栏" onClick={() => setDrawer(true)}><PanelLeftOpen size={18} /></button>
          <button type="button" className={styles.sideEntry} aria-label="展开素材" onClick={() => setDrawer(true)}><FolderOpen size={18} /><span>素材</span></button>
        </>}
        {drawer && <><div className={styles.assetSummary}><span className={styles.eyebrow}>当前工程</span><strong>{editorData.videoRef?.split('/').pop() ?? '尚未导入视频'}</strong><span>{displayTime(durationMs)} · {trackLines.length} 句台词</span><span>配音 {counts.current}/{counts.total} · 待更新 {counts.stale}</span></div><p className={styles.panelHint}>导入与替换素材</p>        <div className={styles.toolbar} aria-label="台词导入与配音生成工具条">
          <button type="button" className={styles.toolBtn} disabled={!editorNode || projectBusy} onClick={() => mediaInput.current?.click()}>导入主视频</button>
          <button type="button" className={styles.toolBtn} disabled={!editorNode || projectBusy} onClick={() => chooseVoice()}>导入整轨配音</button>
          <button type="button" className={styles.toolBtn} disabled={!editorNode || projectBusy} onClick={() => scriptInput.current?.click()}>导入台词</button>
          <button type="button" className={styles.toolBtn} disabled={!editorNode || projectBusy} onClick={() => backgroundInput.current?.click()}>{hasBackground ? '替换背景音乐' : '导入背景音乐'}</button>
          {selectedLineId && linesOf(editorNode?.data ?? {}).some(line => line.id === selectedLineId) && <button type="button" className={styles.toolBtn} disabled={projectBusy} onClick={() => chooseVoice(selectedLineId)}>替换本句音频</button>}
          <button type="button" className={`${styles.toolBtn} ${styles.toolBtnPrimary}`} disabled={!localVoiceAvailable() || projectBusy || !counts.missing} onClick={() => void generateVoice()}>{generating ? '生成中…' : '补齐缺失配音'}</button>
          {generating && <button type="button" className={styles.toolBtn} onClick={() => { generateController.current?.abort(); setToolStatus('已请求停止；已生成音频保留'); }}>停止</button>}
        </div>
          <button type="button" className={styles.toolBtn} disabled={projectBusy} onClick={() => restoreInput.current?.click()}>恢复会话素材</button>
          {editorNode.projectFilePath && onOpenFile && <button type="button" className={styles.toolBtn} onClick={() => onOpenFile(editorNode.projectFilePath!)}>打开画布主文件</button>}
          <RewritePanel data={data} read={editor.draftData} patch={applyEdit} mediaUrl={media.resolve} disabled={projectBusy} ask={ask} />
          <p className={styles.panelHint}>台词与剪辑参数随卡片保存。视频和音频在当前会话可用，刷新后可选择原文件恢复。导出交接包可保留素材和项目清单。</p>
        </>}
      </aside>
      {drawer ? <div className={styles.verticalDivider} {...workspace.separator('left')} /> : <div className={styles.dividerSpacer} />}
      <section className={styles.right} aria-label="画布与配音编辑">
        <div className={styles.timelineWorkspace}>
        <div className={`${styles.panel} ${styles.timelinePanel}`}>
          <div className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>音频时间轴</h2><span className={styles.panelHint}>{trackLines.length} 句 · {displayTime(durationMs)}</span>
          </div>
          <div className={styles.preview}>
            <div className={styles.previewMedia}>
            {videoUrl
              ? <video ref={previewVideo} className={styles.previewVideo} style={{ aspectRatio: `${videoSize.width} / ${videoSize.height}`, width: `${240 * videoSize.width / videoSize.height}px` }}
                  src={videoUrl} controls preload="metadata" muted={!originalAudio} playsInline onLoadedMetadata={event => {
                    const video = event.currentTarget;
                    setVideoSize({ width: video.videoWidth || 16, height: video.videoHeight || 9, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0 });
                  }} />
              : <div className={styles.previewVideo} role="status" style={{ display: 'grid', placeItems: 'center', color: 'var(--text-secondary)', fontSize: 12 }}>暂无视频</div>}
            </div>
            <div className={styles.previewTracks}>
              <div className={styles.timelineToolbar}>{clipActions}<span className={styles.toolDivider} /><button className={styles.iconAction} aria-pressed={snapping} title="吸附片段边界和标记" onClick={() => setSnapping(value => !value)}><Magnet size={15} />吸附</button></div>
              <div className={styles.chipRow}>
                <button className={styles.chip} onClick={() => { setTrackView('all'); setTrackZoom(1); }}>全片概览</button>
                <button className={styles.chip} disabled={!selectedLineId} onClick={() => { setTrackView('focused'); setTrackZoom(1); }}>当前句放大</button>
                <label>缩放 <select aria-label="音轨缩放" value={trackZoom} onChange={event => setTrackZoom(Number(event.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option><option value={8}>8×</option><option value={16}>16×</option></select></label>
                <label>轨高 <select aria-label="音轨高度" value={workspace.layout.trackHeight} onChange={event => workspace.setTrackHeight(Number(event.target.value))}><option value={42}>紧凑</option><option value={56}>标准</option><option value={72}>大</option></select></label>
                <button className={styles.chip} aria-pressed={followPlayhead} onClick={() => setFollowPlayhead(value => !value)}>跟随播放</button>
              </div>
              <div className={styles.timelineViewport} ref={timelineViewport}>
              <div style={{ width: `${trackZoom * 100}%` }}>
              <div className={styles.trackRow}>
                <span className={styles.trackLabel} />
                <div className={styles.timelineTicks} aria-label="时间刻度" onPointerDown={event => startRangeDrag(event, 'original')} {...rangeHandlers}>
                  {cursorVisible && <span aria-hidden="true" className={styles.rulerCursor} style={{ left: `${cursorPercent}%` }} />}
                  {[0, 1, 2, 3, 4].map(tick => {
                    const seconds = (viewStart + viewSpan * tick / 4) / 1000;
                    return <span key={tick}>{seconds.toFixed(viewSpan < 15_000 ? 1 : 0)}s</span>;
                  })}
                </div>
              </div>
              <div className={styles.trackRow}>
                <button className={styles.trackLabel} aria-pressed={selectedTrack === 'original'} onClick={() => chooseTrack('original')}>视频 / 原声</button>
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
                <button className={styles.trackLabel} aria-pressed={selectedTrack === 'voice'} onClick={() => chooseTrack('voice')}>配音音轨</button>
                <div className={styles.trackBase} title={`配音区间 ${voiced.length} 句`} onPointerDown={event => startRangeDrag(event, 'voice')} {...rangeHandlers}>
                  {durationMs > 0 && voiced.filter(line => (line.videoEndMs ?? 0) > viewStart && (line.videoStartMs ?? 0) < viewEnd).map(segment => {
                    const shown = trackGhost?.id === segment.id ? trackGhost : segment;
                    const start = Math.max(0, (Math.max(viewStart, shown.videoStartMs ?? 0) - viewStart) / viewSpan * 100);
                    const width = Math.max(0, (Math.min(viewEnd, shown.videoEndMs ?? 0) - Math.max(viewStart, shown.videoStartMs ?? 0)) / viewSpan * 100);
                    const audio = segments.find(item => item.id === segment.id);
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
                      }}><span className={styles.clipName}>{locked ? '锁定 · ' : ''}{segment.text ?? segment.label ?? segment.id}</span><Waveform readPeaks={readPeaks} mediaUrl={media.resolve} audioRef={audio ? audio.audioRefOverride ?? data.audioRef as string : undefined} offsetMs={(audio?.startMs ?? 0) + visibleOffset} spanMs={waveSpan} playableMs={Math.max(0, Math.min((audio?.endMs ?? 0) - (audio?.startMs ?? 0), (shown.videoEndMs ?? 0) - (shown.videoStartMs ?? 0) - (audio?.gapMs ?? 0)) - visibleOffset)} gain={Number(data.masterGain ?? 1) * (audio?.gain ?? 1)} /></button>;
                  })}
                  {trackOverlay('voice')}
                </div>
              </div>
              {hasBackground && <div className={styles.trackRow}>
                <button className={styles.trackLabel} aria-pressed={selectedTrack === 'background'} onClick={() => chooseTrack('background')}>背景音乐</button>
                <div className={styles.trackBase} title="背景音乐音轨" onPointerDown={event => startRangeDrag(event, 'background')} {...rangeHandlers}>
                  <div className={`${styles.trackSeg} ${styles.trackBackground}`} style={regionStyle({ startMs: 0, endMs: backgroundEnd })}><Waveform readPeaks={readPeaks} mediaUrl={media.resolve} audioRef={data.directorBackgroundRef as string} offsetMs={viewStart} spanMs={Math.min(viewEnd, backgroundEnd) - viewStart} gain={Number(data.directorBackgroundGain ?? 1)} /></div>
                  {trackOverlay('background')}
                </div>
              </div>}
              </div>
              </div>
              <p className={styles.panelHint}>单击定位播放头，拖动时间刻度或音轨空白处框选。Shift 可追加选区。</p>
              {shownRanges.length > 0 && <p className={styles.selectionHint}>
                {shownRanges.length === 1
                  ? `选区 ${displayTime(shownRanges[0]!.startMs)} – ${displayTime(shownRanges[0]!.endMs)}`
                  : `已选 ${shownRanges.length} 段`}
                {' · 拖动选区两端调整起止'}
              </p>}
              <p className={styles.panelHint}>播放头 {displayTime(previewMs)} / {displayTime(durationMs)}</p>
              <p className={styles.panelHint} style={{ margin: 0 }}>
                {counts.total ? `当前配音 ${counts.current}/${counts.total} · 待更新 ${counts.stale} · 区间已确认 ${counts.confirmed}`
                  : segments.length ? '已绑定整轨配音' : '暂无配音'} · {Math.round(durationMs / 1000)} 秒
              </p>
              {trackGhost && <div role="status" className={styles.panelHint}>{((trackGhost.videoStartMs ?? 0) / 1000).toFixed(2)}–{((trackGhost.videoEndMs ?? 0) / 1000).toFixed(2)} 秒</div>}
            </div>
          </div>
        </div>
        {editorNode && <DirectorTools key={editorNode.id} data={data} mediaUrl={media.resolve} rows={timedRows} duration={durationMs}
          time={() => Math.round((previewVideo.current?.currentTime ?? 0) * 1000)} selectedId={selectedLineId}
          select={id => { const line = voiced.find(item => item.id === id); if (line) selectTrackLine(line); }}
          ranges={ranges} setRanges={setRanges} playback={playback} mode={listenMode} setMode={setListenMode}
          disabled={projectBusy} patch={applyEdit} />}
        </div>
        <div className={styles.horizontalDivider} {...workspace.separator('timeline')} />
        <section className={styles.transcript} aria-label="台词浏览">
          <div className={styles.transcriptHeader}>
            <h2 className={styles.panelTitle}>台词列表 <span className={styles.panelHint}>{trackLines.length} 句</span></h2>
            <span className={styles.panelHint}>点击一句，定位声音并在右侧编辑</span>
          </div>
          <div className={styles.transcriptColumns} aria-hidden="true"><span>序号</span><span>台词内容</span><span>时间区间</span><span>区间状态</span></div>
          <div ref={scriptList} className={styles.transcriptRows}>
            {trackLines.map((line, index) => <button type="button" className={styles.transcriptRow} key={line.id} data-script-line-id={line.id}
              aria-pressed={!selectedTrack && selectedLineId === line.id} onClick={() => selectTrackLine(line)}>
              <span className={styles.lineNumber}>{String(index + 1).padStart(2, '0')}</span>
              <span className={styles.lineText}>{line.text ?? line.label ?? '未填写台词'}</span>
              <span className={styles.lineTime}>{Number.isFinite(line.videoStartMs) && Number.isFinite(line.videoEndMs)
                ? `${displayTime(line.videoStartMs!)} – ${displayTime(line.videoEndMs!)}` : '待设置时间'}</span>
              <span className={styles.lineStatus} data-confirmed={editorData.confirmedLineIds?.includes(line.id) ?? false}>{editorData.confirmedLineIds?.includes(line.id) ? '已确认' : '待确认'}</span>
            </button>)}
            {!trackLines.length && <div className={styles.editorEmpty}><p>导入台词后，可在这里逐句浏览和编辑。</p><button className={styles.toolBtn} onClick={() => setDrawer(true)}>导入素材</button></div>}
          </div>
        </section>
        {confirmation && <div role="alertdialog" aria-label="确认当前操作" className={styles.toolbar}
          onKeyDown={event => { if (event.key === 'Escape') answerConfirmation(false); }}>
          <span>{confirmation.message}</span>
          <button type="button" className={styles.toolBtn} autoFocus onClick={() => answerConfirmation(false)}>取消</button>
          <button type="button" className={`${styles.toolBtn} ${styles.toolBtnPrimary}`} onClick={() => answerConfirmation(true)}>{confirmation.label}</button>
        </div>}
        {toolStatus && <div className={styles.notice} role="status">{toolStatus}</div>}
      </section>
      <div className={styles.verticalDivider} {...workspace.separator('right')} />
      <aside className={styles.inspector} aria-label="内容编辑与交付">
        <div className={styles.inspectorTabs} role="group" aria-label="右侧面板">
          {([['content', '内容编辑'], ['check', '检查'], ['export', '导出']] as const).map(([key, label]) => <button className={styles.tabButton} type="button" key={key} aria-pressed={inspectorTab === key} onClick={() => setInspectorTab(key)}>{label}</button>)}
        </div>
        <div className={styles.inspectorBody} hidden={inspectorTab !== 'content'}>
          {selectedTrack && <TrackInspector track={selectedTrack} data={data} disabled={projectBusy} mode={listenMode} setMode={setListenMode} patch={applyEdit} />}
          {!selectedLineId && !selectedTrack && <div className={styles.emptyInspector}>
            <span className={styles.eyebrow}>从一句开始</span><h2>选中要修改的内容</h2>
            <p>点击左侧台词或音轨片段，即可在这里改台词、调音色和音量。</p>
            <p>需要处理一段声音？直接在时间轴拖动框选，再展开下方的选区工具。</p>
            <button type="button" className={`${styles.toolBtn} ${styles.toolBtnPrimary}`} disabled={!trackLines.length} onClick={() => selectTrackLine(trackLines[0]!)}>编辑第一句</button>
            <button type="button" className={styles.toolBtn} onClick={() => trackLines.length ? focusScript() : setDrawer(true)}>{trackLines.length ? '浏览完整台词' : '导入素材'}</button>
          </div>}
          <div hidden={!selectedLineId || Boolean(selectedTrack)}>
            <div className={styles.selectionTitle}><span className={styles.eyebrow}>正在编辑</span><h2>第 {trackLines.findIndex(line => line.id === selectedLineId) + 1} 句</h2>
              <button className={styles.toolBtn} onClick={focusScript}>换一句</button></div>
          <div className={styles.editWorkspace}>
          {editorNode
            ? <div className={styles.editorScroll}><DubbingEditor key={editorNode.id} node={editorNode} selected
                externalVideoRef={previewVideo} selectedLineId={selectedLineId}
                onLineSelect={id => {
                  setSelectedLineId(id);
                  setSelectedTrack(null);
                  setInspectorTab('content');
                  const line = voiced.find(item => item.id === id);
                  if (line) playback.current?.seek(Math.max(0, line.videoStartMs ?? 0));
                }}
                sessionMedia={{ readData: editor.draftData, resolve: media.resolve, add: media.add }}
                onGenerationChange={setLineGenerating} batchGenerating={generating || mediaBusy || deliveryBusy}
                playback={playback} listenMode={listenMode}
                guardPatch={next => assertUnlocked(editor.draftData() ?? {}, next)}
                onPatch={patch => { if (patch.data) editor.patch(patch.data); }} /></div>
            : <div className={styles.editorEmpty} role="status">请在素材面板导入音频或台词。</div>}
          </div>

          </div>
        </div>
        <div className={styles.inspectorBody} hidden={inspectorTab !== 'check'}>
          <div className={styles.emptyInspector}><h2>交付前检查</h2><p>{!editorNode ? '正在读取项目…' : checking.length ? '先处理以下项目，再试听确认。' : '当前检查未发现问题，可试听后导出。'}</p>
            {checking.length > 0 && <ul className={styles.checkList}>{checking.map(issue => <li key={issue}>{issue}</li>)}</ul>}
            <button className={styles.toolBtn} onClick={() => { setInspectorTab('content'); focusScript(); }}>查看台词并处理</button>
            <button className={`${styles.toolBtn} ${styles.toolBtnPrimary}`} disabled={!editorNode} onClick={() => { setInspectorTab('export'); }}>前往导出</button>
          </div>
        </div>
        <div className={styles.inspectorBody} hidden={inspectorTab !== 'export'}>        <section className={styles.delivery}>
          <h3 className={styles.panelTitle}>导出成品</h3><p className={styles.panelHint}>选择需要的文件格式。导出前会检查台词、配音与时间区间。</p>
          <div className={styles.actionRow}>
            <button type="button" className={styles.toolBtn} disabled={!editorNode || projectBusy || !segments.length && !originalAudio && !hasBackground} onClick={() => void deliver('wav')}>导出 WAV</button>
            <button type="button" className={styles.toolBtn} disabled={!counts.total || projectBusy} onClick={() => void deliver('srt')}>导出台词 SRT</button>
            <button type="button" className={styles.toolBtn} disabled={!videoUrl || projectBusy || !durationMs} onClick={() => void deliver('mp4')}>
              {ranges.length === 1 ? '导出选区 MP4' : '导出全片 MP4'}
            </button>
            <label><input type="checkbox" checked={burnCaptions} onChange={event => setBurnCaptions(event.target.checked)} /> 在 MP4 画面中显示字幕</label>
            <button type="button" className={styles.toolBtn} disabled={!editorNode || projectBusy || !durationMs} onClick={() => void deliver('zip')}>下载剪辑交接包</button>
            {deliveryBusy && <button type="button" className={styles.toolBtn} onClick={() => { exportController.current?.abort(); answerConfirmation(false); }}>取消导出</button>}
            <span className={styles.panelHint}>交付音轨 · {listenLabel[listenMode]}</span>
          </div>
        </section>
</div>
      </aside>
    </div>
    {showManual && <ManualDialog onClose={() => setShowManual(false)} />}
    {clipMenu && <div data-clip-menu className={styles.clipMenu} style={{ left: clipMenu.x, top: clipMenu.y }} aria-label="片段操作">{clipActions}</div>}
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
