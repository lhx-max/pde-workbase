'use client';
import { cn } from '../locales/clip-node';
import { CanvasSaveAssetButton } from './CanvasSaveAssetButton';

import React from 'react';
import { createPortal } from 'react-dom';
import { Minus, Pause, Play, Plus, Redo2, Undo2 } from 'lucide-react';
import { Button } from '@bezier/components';
import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import type { ProjectFileResponse } from '@bezier/contracts';
import { compareClipPaintOrder } from '@bezier/contracts';
import { Icon } from '../ui/Icon';
import { getCanvasHostContext, projectFetch, projectFileUrl } from '../platform/api-base';
import type { BasicCanvasNodeData } from './BasicCanvasNode';
import { CanvasNodeActions } from './CanvasNodeActions';
import type { CanvasLinkedAttachment } from './canvas-linked-attachments';
import {
  ImageReferenceResourcePicker,
  type CanvasReferenceResource,
} from './ImageReferenceResourcePicker';
import {
  CLIP_DEFAULT_IMAGE_DURATION,
  CLIP_DEFAULT_MEDIA_DURATION,
  appendClip,
  createEmptyClipTimeline,
  duplicateClip,
  moveClip,
  populatedTimelineTrackCount,
  pruneEmptyTimelineTracks,
  removeClip,
  rippleRemoveClip,
  splitClip,
  timelineDuration,
  CLIP_MIN_DURATION,
  clipRuler,
  formatClipTime,
  type CanvasClipMediaKind,
  type CanvasClipTimeline,
} from './clip-timeline';
import { useClipTimelineInteraction } from './use-clip-timeline-interaction';
import { ClipEditorHostContext } from '../platform/clip-editor-host';
import { ClipPreview } from './ClipPreview';
import { ClipInspector } from './ClipInspector';
import { ClipMediaStrip } from './ClipMediaStrip';
import { ClipExportPanel } from './ClipExportPanel';
import { useClipExport } from './use-clip-export';
import { clipCompositionKey, clipHistoryFor, clipSessionKey, hydrateClipDuration } from './clip-editor-session';
import styles from './ClipDetailedEditor.styles';

const CLIP_EMPTY_NODE_HEIGHT = 156;
const CLIP_LIBRARY_DRAG_MIME = 'application/x-bezier-design-clip-library-asset';
const CLIP_DETAILED_TIMELINE_HEIGHT = 208;
const CLIP_DETAILED_TIMELINE_MIN_HEIGHT = 140;
const CLIP_DETAILED_STAGE_MIN_HEIGHT = 200;
const CLIP_DETAILED_HEADER_HEIGHT = 60;
const CLIP_DETAILED_TIMELINE_TOOLS_HEIGHT = 48;
const CLIP_DETAILED_TIMELINE_HANDLE_HEIGHT = 8;

type ClipLibraryDragAsset = {
  source: 'canvas' | 'timeline';
  key: string;
  kind: CanvasClipMediaKind;
};

function ScissorsGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="7" r="2.5" />
      <circle cx="6" cy="17" r="2.5" />
      <path d="m8.2 8.2 10.3 8.3M8.2 15.8 18.5 7.5" />
    </svg>
  );
}

function uid(prefix = 'clip'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function mediaKind(mimeType: string): CanvasClipMediaKind | null {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return null;
}

export function appendCanvasMediaResources(
  timeline: CanvasClipTimeline,
  resources: readonly CanvasReferenceResource[],
  assetIds: readonly string[],
  createId: () => string = uid,
): CanvasClipTimeline {
  let next = timeline;
  for (const resource of resources) {
    if (!assetIds.includes(resource.id) || !resource.path) continue;
    const kind = resource.kind || mediaKind(resource.mimeType || '');
    if (!kind) continue;
    next = appendClip(next, {
      id: createId(),
      kind,
      name: resource.name,
      path: resource.path,
      mimeType: resource.mimeType || `${kind}/*`,
      duration: kind === 'image' ? CLIP_DEFAULT_IMAGE_DURATION : CLIP_DEFAULT_MEDIA_DURATION,
    });
  }
  return next;
}

const formatTime = formatClipTime;

function readMediaDuration(url: string, kind: CanvasClipMediaKind): Promise<number | undefined> {
  if (kind === 'image') return Promise.resolve(CLIP_DEFAULT_IMAGE_DURATION);
  return new Promise(resolve => {
    const media = document.createElement(kind === 'audio' ? 'audio' : 'video');
    let settled = false;
    const finish = (value?: number) => {
      if (settled) return;
      settled = true;
      media.onloadedmetadata = null;
      media.onerror = null;
      media.removeAttribute('src');
      media.load();
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(), 8_000);
    media.preload = 'metadata';
    media.onloadedmetadata = () => {
      window.clearTimeout(timer);
      finish(Number.isFinite(media.duration) && media.duration > 0 ? media.duration : undefined);
    };
    media.onerror = () => {
      window.clearTimeout(timer);
      finish();
    };
    media.src = url;
  });
}

export function ClipCanvasNode({
  data,
  selected,
  detailed = false,
}: Pick<NodeProps<Node<BasicCanvasNodeData>>, 'data' | 'selected'> & { detailed?: boolean }) {
  const editorHost = React.useContext(ClipEditorHostContext);
  const item = data.node;
  const timeline = React.useMemo(() => {
    const persisted = (item.clipTimeline || createEmptyClipTimeline()) as CanvasClipTimeline & { texts?: unknown; selectedTextId?: unknown };
    // Text overlays were retired. Ignore their legacy JSON without breaking old projects.
    const { texts: _texts, selectedTextId: _selectedTextId, ...mediaTimeline } = persisted;
    return mediaTimeline;
  }, [item.clipTimeline]);
  const [draft, setDraft] = React.useState<CanvasClipTimeline | null>(null);
  const [playing, setPlaying] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [resourcePickerOpen, setResourcePickerOpen] = React.useState(false);
  const [zoom, setZoom] = React.useState(1);
  const [assetSearch, setAssetSearch] = React.useState('');
  const [exportOpen, setExportOpen] = React.useState(false);
  const [detailedTimelineHeight, setDetailedTimelineHeight] = React.useState(CLIP_DETAILED_TIMELINE_HEIGHT);
  const [draggingAsset, setDraggingAsset] = React.useState<ClipLibraryDragAsset | null>(null);
  const [libraryDropTarget, setLibraryDropTarget] = React.useState('');
  const history = { current: clipHistoryFor(clipSessionKey(getCanvasHostContext(), item.id), timeline) };
  const exportController = useClipExport(item.id);
  const [uploading, setBusy] = React.useState(false);
  const busy = uploading || exportController.starting;
  const [, refreshHistory] = React.useReducer(value => value + 1, 0);
  const probedPathsRef = React.useRef(new Set<string>());
  const timelineRef = React.useRef(timeline);
  const detailedNodeRef = React.useRef<HTMLElement>(null);
  const timelineResizeRef = React.useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  timelineRef.current = timeline;
  const visibleTimeline = draft || timeline;
  const selectedClip = visibleTimeline.clips.find(clip => clip.id === visibleTimeline.selectedClipId);
  const total = timelineDuration(visibleTimeline);
  const ruler = clipRuler(timelineDuration(timeline));
  const visualClips = visibleTimeline.clips.filter(clip => clip.kind !== 'audio');
  const audioClips = visibleTimeline.clips.filter(clip => clip.kind === 'audio');
  const previewError = React.useCallback((error: string) => { setMessage(error); setPlaying(false); }, []);

  const maxDetailedTimelineHeight = React.useCallback(() => {
    const availableHeight = detailedNodeRef.current?.clientHeight || window.innerHeight || 720;
    return Math.max(
      CLIP_DETAILED_TIMELINE_MIN_HEIGHT,
      Math.min(560, availableHeight - CLIP_DETAILED_HEADER_HEIGHT - CLIP_DETAILED_STAGE_MIN_HEIGHT - CLIP_DETAILED_TIMELINE_TOOLS_HEIGHT - CLIP_DETAILED_TIMELINE_HANDLE_HEIGHT),
    );
  }, []);
  const setClampedTimelineHeight = React.useCallback((nextHeight: number) => {
    setDetailedTimelineHeight(Math.round(Math.max(CLIP_DETAILED_TIMELINE_MIN_HEIGHT, Math.min(maxDetailedTimelineHeight(), nextHeight))));
  }, [maxDetailedTimelineHeight]);
  const beginTimelineResize = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    timelineResizeRef.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: detailedTimelineHeight };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [detailedTimelineHeight]);
  const updateTimelineResize = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const resizing = timelineResizeRef.current;
    if (!resizing || resizing.pointerId !== event.pointerId) return;
    event.preventDefault();
    setClampedTimelineHeight(resizing.startHeight + resizing.startY - event.clientY);
  }, [setClampedTimelineHeight]);
  const endTimelineResize = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (timelineResizeRef.current?.pointerId !== event.pointerId) return;
    timelineResizeRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  const commit = React.useCallback((next: CanvasClipTimeline) => {
    next = pruneEmptyTimelineTracks(next);
    next = { ...next, playhead: Math.max(0, Math.min(next.playhead, timelineDuration(next))) };
    if (JSON.stringify({ ...next, playhead: 0, selectedClipId: '' }) !== JSON.stringify({ ...timelineRef.current, playhead: 0, selectedClipId: '' })) {
      history.current.past = [...history.current.past.slice(-49), timelineRef.current];
      history.current.future = [];
      setMessage('');
      refreshHistory();
    }
    timelineRef.current = next;
    history.current.current = clipCompositionKey(next);
    data.onPatch(item.id, { clipTimeline: next, ...(item.clipExportKey && item.clipExportKey !== history.current.current ? { projectFilePath: undefined } : {}) });
  }, [data, item.id]);

  React.useEffect(() => {
    const end = timelineDuration(timeline);
    if (timeline.playhead <= end) return;
    commit({ ...timeline, playhead: end });
  }, [commit, timeline]);

  React.useEffect(() => {
    const pruned = pruneEmptyTimelineTracks(timeline);
    if (pruned !== timeline) commit(pruned);
  }, [commit, timeline]);

  const timelineElement = React.useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = React.useState<number | null>(null);
  const autoHeight = contentHeight ?? item.height ?? CLIP_EMPTY_NODE_HEIGHT;
  React.useLayoutEffect(() => {
    if (detailed || !timelineElement.current) return;
    const element = timelineElement.current;
    // Unscaled measurements keep persisted bounds independent of canvas zoom.
    const measure = () => {
      if (element.offsetHeight > 0) setContentHeight(Math.max(CLIP_EMPTY_NODE_HEIGHT, element.offsetHeight + 54));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [detailed]);
  React.useEffect(() => {
    if (!detailed && contentHeight !== null && item.height !== contentHeight) data.onPatch(item.id, { height: contentHeight });
  }, [contentHeight, detailed, data, item.height, item.id]);

  React.useEffect(() => {
    const supported = (item.linkedAttachments || [])
      .map(attachment => ({ attachment, kind: mediaKind(attachment.mimeType) }))
      .filter((entry): entry is { attachment: CanvasLinkedAttachment; kind: CanvasClipMediaKind } => Boolean(entry.kind));
    const connectedKeys = new Set(supported.map(({ attachment }) => `${attachment.sourceNodeId}:${attachment.path}`));
    let next = {
      ...timeline,
      clips: timeline.clips.filter(clip => !clip.sourceNodeId || connectedKeys.has(`${clip.sourceNodeId}:${clip.path}`)),
    };
    let changed = next.clips.length !== timeline.clips.length;
    for (const { attachment, kind } of supported) {
      if (next.clips.some(clip => clip.sourceNodeId === attachment.sourceNodeId && clip.path === attachment.path)) continue;
      next = appendClip(next, {
        id: uid(),
        kind,
        name: attachment.name,
        path: attachment.path,
        mimeType: attachment.mimeType,
        sourceNodeId: attachment.sourceNodeId,
        duration: kind === 'image' ? CLIP_DEFAULT_IMAGE_DURATION : CLIP_DEFAULT_MEDIA_DURATION,
      });
      changed = true;
    }
    if (changed) commit(next);
  }, [item.linkedAttachments]);

  React.useEffect(() => {
    const pending = timeline.clips.filter(clip => clip.kind !== 'image' && !clip.sourceDuration && !probedPathsRef.current.has(clip.path));
    for (const clip of pending) {
      probedPathsRef.current.add(clip.path);
      void readMediaDuration(projectFileUrl(clip.path), clip.kind).then(duration => {
        if (!duration) return;
        const current = timelineRef.current;
        if (!current.clips.some(entry => entry.id === clip.id)) return;
        const currentHistory = clipHistoryFor(clipSessionKey(getCanvasHostContext(), item.id), current);
        const next = hydrateClipDuration(currentHistory, current, clip.path, duration);
        timelineRef.current = next;
        data.onPatch(item.id, { clipTimeline: next });
      });
    }
  }, [timeline.clips, commit]);

  React.useEffect(() => {
    if (!playing) return;
    const startedAt = performance.now() - visibleTimeline.playhead * 1_000;
    let frame = 0;
    let lastFrame = -1;
    const tick = (now: number) => {
      const playhead = (now - startedAt) / 1_000;
      if (playhead >= total) {
        setPlaying(false);
        setDraft(null);
        commit({ ...timeline, playhead: total });
        return;
      }
      const frameIndex = Math.floor(playhead * 30);
      if (frameIndex !== lastFrame) {
        lastFrame = frameIndex;
        setDraft({ ...timeline, playhead });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  function stopPlayback() {
    setPlaying(false);
    if (draft) {
      commit(draft);
      setDraft(null);
    }
  }

  const { gesture, begin } = useClipTimelineInteraction({
    timeline: visibleTimeline, scaleDuration: ruler.duration,
    onPreview: setDraft, onCommit: commit, onStart: () => setPlaying(false),
  });
  const scaleDuration = gesture?.duration || ruler.duration;

  function undo(redo = false) {
    setPlaying(false);
    setDraft(null);
    const source = redo ? history.current.future : history.current.past;
    const destination = redo ? history.current.past : history.current.future;
    const previous = source.pop();
    if (!previous) return;
    destination.push(timelineRef.current);
    timelineRef.current = previous;
    history.current.current = clipCompositionKey(previous);
    data.onPatch(item.id, { clipTimeline: previous, ...(item.clipExportKey && item.clipExportKey !== history.current.current ? { projectFilePath: undefined } : {}) });
    setMessage('');
    refreshHistory();
  }

  function togglePlayback() {
    if (playing) { stopPlayback(); return; }
    if (visibleTimeline.playhead >= total) {
      commit({ ...visibleTimeline, playhead: 0 });
      setDraft(null);
    }
    setPlaying(true);
  }

  const edit = React.useCallback((next: CanvasClipTimeline) => {
    setPlaying(false);
    setDraft(null);
    commit(next);
  }, [commit]);

  async function addFiles(files: readonly File[]): Promise<boolean> {
    const requestContext = getCanvasHostContext();
    const accepted = files.filter(file => mediaKind(file.type));
    if (accepted.length === 0) return false;
    setBusy(true);
    setMessage('');
    try {
      let next = timeline;
      for (const file of accepted) {
        const kind = mediaKind(file.type)!;
        const objectUrl = URL.createObjectURL(file);
        const duration = await readMediaDuration(objectUrl, kind).finally(() => URL.revokeObjectURL(objectUrl));
        const form = new FormData();
        form.append('file', file, file.name);
        form.append('name', cn().ui.uploadPath(file.name, Date.now()));
        const response = await projectFetch('/files', { method: 'POST', body: form }, requestContext);
        const payload = await response.json().catch(() => null) as ProjectFileResponse | { error?: { message?: string } } | null;
        const uploaded = payload && 'file' in payload ? payload.file : undefined;
        if (!response.ok || !uploaded) throw new Error(payload && 'error' in payload ? payload.error?.message : cn().ui.uploadFailedHttp(response.status));
        next = appendClip(next, {
          id: uid(),
          kind,
          name: file.name,
          path: uploaded.path || uploaded.name,
          mimeType: uploaded.mime || file.type,
          duration: duration || (kind === 'image' ? CLIP_DEFAULT_IMAGE_DURATION : CLIP_DEFAULT_MEDIA_DURATION),
          ...(duration ? { sourceDuration: duration } : {}),
        });
      }
      commit(next);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : cn().ui.addMediaFailed);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function addCanvasResources(assetIds: string[]) {
    const next = appendCanvasMediaResources(timeline, data.canvasMediaResources || [], assetIds);
    if (next !== timeline) commit(next);
    setResourcePickerOpen(false);
  }

  function beginLibraryDrag(event: React.DragEvent<HTMLElement>, asset: ClipLibraryDragAsset) {
    stopPlayback();
    setDraggingAsset(asset);
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(CLIP_LIBRARY_DRAG_MIME, JSON.stringify(asset));
    event.dataTransfer.setData('text/plain', asset.key);
  }

  function readLibraryDrag(event: React.DragEvent<HTMLElement>): ClipLibraryDragAsset | null {
    if (draggingAsset) return draggingAsset;
    try {
      const parsed = JSON.parse(event.dataTransfer.getData(CLIP_LIBRARY_DRAG_MIME)) as Partial<ClipLibraryDragAsset>;
      if ((parsed.source === 'canvas' || parsed.source === 'timeline') && typeof parsed.key === 'string'
        && (parsed.kind === 'image' || parsed.kind === 'video' || parsed.kind === 'audio')) return parsed as ClipLibraryDragAsset;
    } catch { /* Ignore external and malformed drag data. */ }
    return null;
  }

  function insertLibraryAsset(asset: ClipLibraryDragAsset, start: number, track: number): boolean {
    const current = timelineRef.current;
    const source = asset.source === 'canvas'
      ? (data.canvasMediaResources || []).find(resource => resource.id === asset.key)
      : current.clips.find(clip => clip.path === asset.key);
    if (!source?.path) return false;
    const kind = source.kind || mediaKind(source.mimeType || '') || asset.kind;
    if (!kind) return false;
    const id = uid();
    const duration = 'duration' in source ? source.duration : kind === 'image' ? CLIP_DEFAULT_IMAGE_DURATION : CLIP_DEFAULT_MEDIA_DURATION;
    const clip = {
      ...source,
      id,
      kind,
      path: source.path,
      mimeType: source.mimeType || `${kind}/*`,
      start: Math.max(0, Number.isFinite(start) ? start : 0),
      sourceIn: 0,
      duration,
      track,
    };
    edit({ ...current, clips: [...current.clips, clip], selectedClipId: id });
    return true;
  }

  function dropLibraryAsset(event: React.DragEvent<HTMLElement>, trackKind: 'visual' | 'audio', track: number, start = 0) {
    const asset = readLibraryDrag(event);
    if (!asset || (trackKind === 'audio') !== (asset.kind === 'audio')) return;
    event.preventDefault();
    event.stopPropagation();
    if (insertLibraryAsset(asset, start, track)) event.dataTransfer.dropEffect = 'copy';
    setDraggingAsset(null);
    setLibraryDropTarget('');
  }

  const exported = exportController.record;
  const compositionKey = clipCompositionKey(timeline);
  React.useEffect(() => {
    if (exported?.job.status !== 'complete' || exported.options.format !== 'mp4' || !exported.job.file?.path) return;
    if (exported.compositionKey !== compositionKey) return;
    if (item.projectFilePath === exported.job.file.path && item.clipExportKey === compositionKey) return;
    data.onPatch(item.id, { projectFilePath: exported.job.file.path, sourceMime: 'video/mp4', clipExportKey: compositionKey });
  }, [exported, compositionKey, item.projectFilePath, item.clipExportKey, item.id, data]);


  const canSplit = selectedClip && visibleTimeline.playhead > selectedClip.start + CLIP_MIN_DURATION
    && visibleTimeline.playhead < selectedClip.start + selectedClip.duration - CLIP_MIN_DURATION;
  const editTime = gesture?.clipId && selectedClip
    ? selectedClip.start + (gesture.mode === 'trim-end' ? selectedClip.duration : 0) : undefined;
  const preview = <div className={`clip-node-preview nodrag nopan nowheel${detailed ? ` ${styles.preview}` : ''}`} style={detailed ? { aspectRatio: `${visibleTimeline.width || 1280} / ${visibleTimeline.height || 720}`, '--clip-preview-ratio': (visibleTimeline.width || 1280) / (visibleTimeline.height || 720) } as React.CSSProperties : undefined}>
    <span className="clip-node-preview-label">{cn().ui.previewDot} {formatTime(visibleTimeline.playhead)}</span>
    <ClipPreview timeline={visibleTimeline} playing={playing} onError={previewError} interactive={detailed} onSelect={detailed ? clipId => { if (timelineRef.current.selectedClipId !== clipId) commit({ ...timelineRef.current, selectedClipId: clipId }); } : undefined} onTransform={detailed ? (clipId, visual) => edit({ ...visibleTimeline, clips: visibleTimeline.clips.map(clip => clip.id === clipId ? { ...clip, visual } : clip) }) : undefined} />
  </div>;
  const rulerStep = detailed ? Math.max(0.25, ruler.step / Math.min(zoom, 8)) : ruler.step;
  const marks = Array.from({ length: Math.min(600, Math.floor(scaleDuration / rulerStep) + 1) }, (_, i) => i * rulerStep);
  // Detailed editing always keeps one virtual drop row above the real tracks.
  // A successful drop materializes a new highest track, so the virtual row remains
  // available as the next empty row without persisting a placeholder track.
  const videoTrackCount = populatedTimelineTrackCount(visibleTimeline, 'visual');
  const audioTrackCount = populatedTimelineTrackCount(visibleTimeline, 'audio');
  const patchTrack = (kind: 'visual' | 'audio', index: number, values: { locked?: boolean; muted?: boolean; solo?: boolean }) => {
    const states = visibleTimeline.trackStates || [];
    const current = states.find(track => track.kind === kind && track.index === index) || { kind, index };
    edit({ ...visibleTimeline, trackStates: [...states.filter(track => track.kind !== kind || track.index !== index), { ...current, ...values }] });
  };
  const renderTrack = (clips: typeof visibleTimeline.clips, label: string, index?: number) => {
    const kind: 'visual' | 'audio' = label.startsWith(cn().labels.audio) ? 'audio' : 'visual';
    const trackState = index === undefined ? undefined : visibleTimeline.trackStates?.find(track => track.kind === kind && track.index === index);
    return (
    <div className="clip-track-row" key={label} data-track-muted={trackState?.muted || undefined} data-track-solo={trackState?.solo || undefined}>
      <span className="clip-track-label">{label}{detailed && index !== undefined ? <span className="clip-track-actions"><button type="button" aria-label={`${label}${trackState?.locked?cn().actions.unlock:cn().actions.lock}`} aria-pressed={Boolean(trackState?.locked)} onClick={()=>patchTrack(kind,index,{locked:!trackState?.locked})}>{cn().actions.lockShort}</button><button type="button" aria-label={`${label}${trackState?.muted?cn().actions.unmute:cn().actions.mute}`} aria-pressed={Boolean(trackState?.muted)} onClick={()=>patchTrack(kind,index,{muted:!trackState?.muted})}>{cn().actions.muteShort}</button><button type="button" aria-label={`${label}${trackState?.solo?cn().actions.unsolo:cn().actions.solo}`} aria-pressed={Boolean(trackState?.solo)} onClick={()=>patchTrack(kind,index,{solo:!trackState?.solo})}>{cn().actions.soloShort}</button></span> : null}</span>
      <div
        className="clip-track"
        data-clip-track
        data-track-index={index}
        data-track-kind={label.startsWith(cn().labels.audio) ? 'audio' : 'visual'}
        data-track-locked={trackState?.locked || undefined}
        data-library-drop-active={libraryDropTarget === `${kind}:${index ?? 0}` || undefined}
        style={{ backgroundSize: `${ruler.step / scaleDuration * 100}% 100%` }}
        onPointerDown={event => {
          if (event.target !== event.currentTarget) return;
          begin(event, 'scrub');
        }}
        onDragOver={event => {
          if (trackState?.locked || !draggingAsset || (kind === 'audio') !== (draggingAsset.kind === 'audio')) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setLibraryDropTarget(`${kind}:${index ?? 0}`);
        }}
        onDragLeave={event => {
          if (!event.currentTarget.contains(event.relatedTarget as HTMLElement | null)) setLibraryDropTarget('');
        }}
        onDrop={event => {
          const rect = event.currentTarget.getBoundingClientRect();
          const start = rect.width && Number.isFinite(event.clientX) ? (event.clientX - rect.left) / rect.width * scaleDuration : 0;
          dropLibraryAsset(event, kind, index ?? 0, start);
        }}
      >
        {clips.slice().sort(compareClipPaintOrder).map(clip => (
          <button
            key={clip.id}
            type="button"
            className={`clip-timeline-item${clip.id === visibleTimeline.selectedClipId ? ' is-selected' : ''}`}
            data-media-kind={clip.kind}
            style={{ left: `${clip.start / scaleDuration * 100}%`, width: `${clip.duration / scaleDuration * 100}%` }}
            onPointerDown={event => { if (!trackState?.locked) begin(event, 'move', clip.id); }}
            onClick={event => event.stopPropagation()}
            onFocus={() => !gesture && commit({ ...timelineRef.current, selectedClipId: clip.id })}
            aria-label={cn().ui.clipAria(clip.name, formatTime(clip.start), formatTime(clip.duration))}
            title={cn().ui.clipTooltip(clip.name, formatTime(clip.start), formatTime(clip.start + clip.duration), formatTime(clip.duration))}
          >
            <ClipMediaStrip clip={clip} url={projectFileUrl(clip.path)} enabled={detailed} />
            <span className="clip-trim-handle" data-trim="start" title={cn().actions.trimStart} onPointerDown={event => { if (!trackState?.locked) begin(event, 'trim-start', clip.id); }} />
            <span className="clip-item-name">{clip.kind === 'audio' ? '♪ ' : ''}{clip.name}</span>
            <span className="clip-trim-handle is-end" data-trim="end" title={cn().actions.trimEnd} onPointerDown={event => { if (!trackState?.locked) begin(event, 'trim-end', clip.id); }} />
          </button>
        ))}
        {gesture?.snap !== undefined ? <span className="clip-snap-guide" style={{ left: `${gesture.snap / scaleDuration * 100}%` }} /> : null}
        <span className="clip-playhead" style={{ left: `${visibleTimeline.playhead / scaleDuration * 100}%` }} onPointerDown={event => begin(event, 'scrub')} />
      </div>
    </div>
    );
  };

  const renderNewTrack = () => (
    <div className="clip-track-row" data-clip-new-track>
      <span className="clip-track-label">{cn().actions.newTrack}</span>
      <div
        className={`clip-track ${styles.emptyTrack}`}
        data-library-drop-active={libraryDropTarget === 'new-track' || undefined}
        style={{ backgroundSize: `${ruler.step / scaleDuration * 100}% 100%` }}
        onDragOver={event => {
          if (!draggingAsset) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setLibraryDropTarget('new-track');
        }}
        onDragLeave={event => {
          if (!event.currentTarget.contains(event.relatedTarget as HTMLElement | null)) setLibraryDropTarget('');
        }}
        onDrop={event => {
          const asset = readLibraryDrag(event);
          if (!asset) return;
          event.preventDefault();
          event.stopPropagation();
          const track = asset.kind === 'audio' ? audioTrackCount : videoTrackCount;
          if (insertLibraryAsset(asset, 0, track)) event.dataTransfer.dropEffect = 'copy';
          setDraggingAsset(null);
          setLibraryDropTarget('');
        }}
      >
        <span>{draggingAsset ? cn().ui.dropOnNewTrack : cn().ui.dropMediaHere}</span>
      </div>
    </div>
  );

  return (
    <article
      data-canvas-node-surface
      data-compact={!detailed || undefined}
      ref={detailed ? detailedNodeRef : undefined}
      style={!detailed ? { height: autoHeight, minHeight: autoHeight } : { '--clip-timeline-height': `${detailedTimelineHeight}px` } as React.CSSProperties}
      className={`clip-canvas-node${selected && !detailed ? ' is-selected' : ''}${detailed ? ` ${styles.editor}` : ''}`}
      data-empty={total === 0 || undefined}
      tabIndex={0}
      onKeyDown={event => {
        const target = event.target as HTMLElement;
        if (resourcePickerOpen || target.closest('input,select,textarea,[contenteditable="true"]')) return;
        const command = event.metaKey || event.ctrlKey;
        const key = event.key.toLowerCase();
        if (command && key === 'z') { event.preventDefault(); event.stopPropagation(); undo(event.shiftKey); return; }
        if (gesture) return;
        if (command && key === 'd' && selectedClip) { event.preventDefault(); event.stopPropagation(); edit(duplicateClip(visibleTimeline, selectedClip.id, uid())); return; }
        if (key === 'delete' || key === 'backspace') {
          event.preventDefault();
          event.stopPropagation();
          if (event.target === event.currentTarget) {
            if (!detailed) data.onRemove(item.id);
            return;
          }
          if (selectedClip && target.closest('.clip-timeline-item,[data-preview-clip]')) {
            edit(event.shiftKey ? rippleRemoveClip(visibleTimeline, selectedClip.id) : removeClip(visibleTimeline, selectedClip.id));
          }
          return;
        }
        if (key === 's' && !command && canSplit) { event.preventDefault(); event.stopPropagation(); edit(splitClip(visibleTimeline, selectedClip!.id, visibleTimeline.playhead, uid())); return; }
        if (event.code === 'Space' && total) {
          const button = (event.target as HTMLElement).closest('button');
          if (button && !button.classList.contains('clip-timeline-item')) return;
          event.preventDefault(); event.stopPropagation(); togglePlayback(); return;
        }
        if (key === 'arrowleft' || key === 'arrowright' || key === 'home' || key === 'end') {
          event.preventDefault(); event.stopPropagation();
          const delta = (key === 'arrowleft' ? -1 : 1) * (event.shiftKey ? 1 : 0.1);
          if (event.altKey && selectedClip && key.startsWith('arrow')) edit(moveClip(visibleTimeline, selectedClip.id, selectedClip.start + delta));
          else edit({ ...visibleTimeline, playhead: key === 'home' ? 0 : key === 'end' ? total : Math.max(0, Math.min(total, visibleTimeline.playhead + delta)) });
        }
      }}
    >
      {!detailed ? <NodeResizer
        isVisible={selected}
        minWidth={620}
        minHeight={autoHeight}
        maxHeight={autoHeight}
        lineClassName="basic-node-resizer-line"
        handleClassName="basic-node-resizer-handle"
        onResizeEnd={(_, params) => data.onPatch(item.id, { width: params.width, height: autoHeight })}
      /> : null}
      <header className="clip-node-header node-drag-surface">
        {item.projectFilePath && item.clipExportKey === compositionKey ? <CanvasSaveAssetButton nodeId={item.id} draft={{ name: item.title || cn().actions.editVideo, filename: item.projectFilePath.split('/').pop()!, mime: 'video/mp4', url: projectFileUrl(item.projectFilePath) }} /> : null}
        {!detailed ? <span className="clip-node-title"><ScissorsGlyph />{item.title || cn().labels.timeline}</span> : null}
        {!detailed && editorHost.onOpen ? <Button variant="ghost" className="nodrag" aria-label={cn().actions.enterDetail} onPointerDown={event => event.stopPropagation()} onClick={() => { stopPlayback(); editorHost.onOpen?.(item.id); }}>{cn().actions.detailedEdit} <Icon name="expand" size={13} /></Button> : null}
        {detailed ? <Button variant="subtle" className={styles.backButton} onClick={() => { stopPlayback(); editorHost.onBack?.(); }}><svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m10 5-7 7 7 7M3 12h18" /></svg>{cn().actions.backToCanvas}</Button> : null}
        {/* 节点级复制/删除，和下面那排是两码事：下面 .clip-node-actions 里的
            「复制片段 / 删除片段」作用于时间轴上选中的那一段，这里作用于整张
            剪辑卡。详细剪辑模式下卡片占满工作区、不在画布语境里，不给这组。 */}
        {!detailed ? (
          <CanvasNodeActions
            onDuplicate={() => data.onDuplicate(item.id)}
            onRemove={() => data.onRemove(item.id)}
            duplicateLabel={cn().actions.duplicateCard}
            onDownload={() => { stopPlayback(); setExportOpen(true); }}
            downloadLabel={cn().actions.exportVideo}
            downloadDisabled={!total && !exported}
            removeLabel={cn().actions.deleteCard}
          />
        ) : null}
        {selected ? (
          <div className="clip-node-actions nodrag" onPointerDown={event => event.stopPropagation()}>
            {!detailed ? <><Button variant="ghost" size="icon" disabled={!history.current.past.length} aria-label={cn().actions.undoClip} title={cn().actions.undoShortcut} onClick={() => undo()}><span aria-hidden>↶</span></Button>
            <Button variant="ghost" size="icon" disabled={!history.current.future.length} aria-label={cn().actions.redoClip} title={cn().actions.redoShortcut} onClick={() => undo(true)}><span aria-hidden>↷</span></Button>
            <Button variant="ghost" size="icon" disabled={!canSplit} aria-label={cn().actions.splitClip} title={cn().ui.splitHint} onClick={() => selectedClip && edit(splitClip(visibleTimeline, selectedClip.id, visibleTimeline.playhead, uid()))}><ScissorsGlyph size={15} /></Button>
            <Button variant="ghost" size={detailed ? 'default' : 'icon'} disabled={!selectedClip} aria-label={cn().actions.duplicateClip} title={cn().actions.duplicateClipShortcut} onClick={() => selectedClip && edit(duplicateClip(visibleTimeline, selectedClip.id, uid()))}><Icon name="copy" size={16} />{detailed ? cn().actions.duplicate : null}</Button>
            <Button variant="ghost" size={detailed ? 'default' : 'icon'} disabled={!selectedClip} aria-label={cn().actions.deleteClip} title={cn().actions.deleteClipShortcut} onClick={() => selectedClip && edit(removeClip(visibleTimeline, selectedClip.id))}><Icon name="trash" size={16} />{detailed ? cn().actions.delete : null}</Button>
            </> : null}{!detailed ? <span className="clip-node-divider" /> : null}
            {item.projectFilePath && item.clipExportKey === compositionKey ? <a className="nodrag" href={projectFileUrl(item.projectFilePath)} target="_blank" rel="noreferrer" onPointerDown={event => event.stopPropagation()}>{cn().actions.viewExport}</a> : null}
            {item.clipExportKey && item.clipExportKey !== compositionKey ? <span role="status">{cn().actions.needsReexport}</span> : null}
            {detailed ? <Button variant="primary" className={styles.exportButton} disabled={!total && !exported} aria-label={cn().actions.exportVideo} title={cn().actions.exportOrJobs} onClick={() => { stopPlayback(); setExportOpen(true); }}><Icon name="arrow-down" size={16} />{exportController.running ? cn().actions.exporting : cn().actions.export}</Button> : null}
          </div>
        ) : null}
      </header>

      {detailed ? <div className={styles.stage} data-empty={!total || undefined}>
        <aside className={styles.assets} aria-label={cn().ui.mediaTitle}>
          <div className={styles.libraryHeading}><strong>{cn().ui.mediaTitle}</strong></div>
          <div className={styles.mediaLibrary}>
          <div className={styles.libraryActions}><input className={styles.search} aria-label={cn().ui.searchMedia} placeholder={cn().ui.searchPlaceholder} value={assetSearch} onChange={event => setAssetSearch(event.target.value)} /><Button variant="subtle" size="icon" className="bezier-tooltip" data-tooltip={cn().ui.addFromSpace} data-tooltip-placement="bottom" aria-label={cn().actions.addMedia} title={cn().ui.addFromSpace} aria-haspopup="dialog" aria-expanded={resourcePickerOpen} onClick={() => setResourcePickerOpen(true)} disabled={busy}><Icon name="plus" size={16} /></Button></div>
          <p className={styles.hint}>{cn().ui.clickOrDrop}</p>
          {(data.canvasMediaResources || []).filter(resource => resource.name.toLowerCase().includes(assetSearch.toLowerCase())).map(resource => { const kind = resource.kind || mediaKind(resource.mimeType || '') || 'image'; return <Button key={resource.id} variant="ghost" className={styles.asset} disabled={busy} draggable={!busy} title={cn().ui.dragOrClick(resource.name)} onDragStart={event => beginLibraryDrag(event, {source:'canvas',key:resource.id,kind})} onDragEnd={()=>{setDraggingAsset(null);setLibraryDropTarget('');}} onClick={() => addCanvasResources([resource.id])}>
            <span className={styles.assetPreview}>{resource.path ? <ClipMediaStrip clip={{ id: resource.id, name: resource.name, path: resource.path, mimeType: resource.mimeType || '', kind: resource.kind || mediaKind(resource.mimeType || '') || 'image', start: 0, sourceIn: 0, duration: 5 }} url={projectFileUrl(resource.path)} enabled /> : resource.kind === 'audio' ? '♪' : '▶'}</span><span className={styles.assetCaption}><span>{resource.name}</span><small>{resource.kind === 'audio' ? cn().labels.audio : resource.kind === 'video' ? cn().labels.video : cn().labels.image} {cn().ui.clickToAdd}</small></span>
          </Button>})}
          {timeline.clips.some(clip => !(data.canvasMediaResources || []).some(resource => resource.path === clip.path)) ? <h3>{cn().ui.imported}</h3> : null}{Array.from(new Map(timeline.clips.map(clip => [clip.path, clip])).values()).filter(clip => !(data.canvasMediaResources || []).some(resource => resource.path === clip.path) && clip.name.toLowerCase().includes(assetSearch.toLowerCase())).map(clip => <Button key={clip.path} variant="ghost" className={styles.asset} draggable title={cn().ui.dragOrClick(clip.name)} onDragStart={event => beginLibraryDrag(event,{source:'timeline',key:clip.path,kind:clip.kind})} onDragEnd={()=>{setDraggingAsset(null);setLibraryDropTarget('');}} onClick={() => edit(appendClip(visibleTimeline, { ...clip, id: uid() }))}><span className={styles.assetPreview}><ClipMediaStrip clip={clip} url={projectFileUrl(clip.path)} enabled /></span><span className={styles.assetCaption}><span>{clip.name}</span><small>{clip.kind === 'audio' ? cn().labels.audio : clip.kind === 'image' ? cn().labels.image : cn().labels.video} {cn().ui.addAgain}</small></span></Button>)}
          {assetSearch && !(data.canvasMediaResources || []).some(resource => resource.name.toLowerCase().includes(assetSearch.toLowerCase())) && !timeline.clips.some(clip => clip.name.toLowerCase().includes(assetSearch.toLowerCase())) ? <p className={styles.hint} role="status">{cn().ui.noMediaFound}</p> : null}
          </div>
        </aside>
        <div className={styles.monitor}>
          {total ? preview : <div className={styles.emptyPreview} style={{ aspectRatio: `${visibleTimeline.width || 1280}/${visibleTimeline.height || 720}`, '--clip-preview-ratio': (visibleTimeline.width || 1280) / (visibleTimeline.height || 720) } as React.CSSProperties}>
            <span className={styles.emptyPreviewIcon}><ScissorsGlyph size={20} /></span>
            <h2>{cn().ui.previewEmpty}</h2><p>{cn().ui.startHint}</p>
          </div>}
          <div className={styles.monitorTransport}>
            <Button variant="subtle" size="icon" className="bezier-tooltip" data-tooltip={playing ? cn().ui.pauseMonitor : cn().ui.playMonitor} data-tooltip-placement="top" disabled={!total} aria-label={playing ? cn().ui.pauseMonitor : cn().ui.playMonitor} onClick={togglePlayback}>
              {playing ? <Pause aria-hidden size={14} strokeWidth={1.7} /> : <Play aria-hidden size={14} strokeWidth={1.7} />}
            </Button>
            <span>{formatTime(visibleTimeline.playhead)}<span aria-hidden> / </span>{formatTime(total)}</span>
          </div>
        </div>
        <aside className={styles.contextPanel} aria-label={cn().ui.settings}>
          <ClipInspector timeline={playing ? timeline : visibleTimeline} onChange={edit} showQuickControls={false} />
        </aside>
      </div> : selected && total > 0 ? preview : null}

      {detailed ? <>
        <div
          className={`${styles.timelineResizeHandle} nodrag nopan`}
          role="separator"
          tabIndex={0}
          aria-label={cn().ui.adjustHeight}
          aria-orientation="horizontal"
          aria-valuemin={CLIP_DETAILED_TIMELINE_MIN_HEIGHT}
          aria-valuemax={maxDetailedTimelineHeight()}
          aria-valuenow={detailedTimelineHeight}
          onPointerDown={beginTimelineResize}
          onPointerMove={updateTimelineResize}
          onPointerUp={endTimelineResize}
          onPointerCancel={endTimelineResize}
          onKeyDown={event => {
            const step = 24;
            if (event.key === 'ArrowUp') { event.preventDefault(); setClampedTimelineHeight(detailedTimelineHeight + step); }
            else if (event.key === 'ArrowDown') { event.preventDefault(); setClampedTimelineHeight(detailedTimelineHeight - step); }
            else if (event.key === 'Home') { event.preventDefault(); setClampedTimelineHeight(CLIP_DETAILED_TIMELINE_MIN_HEIGHT); }
            else if (event.key === 'End') { event.preventDefault(); setClampedTimelineHeight(maxDetailedTimelineHeight()); }
          }}
        ><span /></div>
        <div className={styles.timelineTools}>
          <strong>{cn().ui.clipOrder}</strong><span className={styles.timelineHelp}>{total ? cn().ui.dragTrimHint : cn().ui.dragNewTrack}</span>
          <div className={styles.timelineActions}>
            <Button variant="ghost" size="icon" className="bezier-tooltip" data-tooltip={cn().actions.undoShortcut} data-tooltip-placement="top" disabled={!history.current.past.length} aria-label={cn().actions.undoClip} title={cn().actions.undoShortcut} onClick={() => undo()}><Undo2 aria-hidden size={15} strokeWidth={1.7} /></Button>
            <Button variant="ghost" size="icon" className="bezier-tooltip" data-tooltip={cn().actions.redoShortcut} data-tooltip-placement="top" disabled={!history.current.future.length} aria-label={cn().actions.redoClip} title={cn().actions.redoShortcut} onClick={() => undo(true)}><Redo2 aria-hidden size={15} strokeWidth={1.7} /></Button>
            <Button variant="ghost" size="icon" className="bezier-tooltip" data-tooltip={cn().ui.splitAtPlayhead} data-tooltip-placement="top" aria-label={cn().actions.splitClip} title={cn().ui.splitAtPlayhead} disabled={!canSplit} onClick={() => selectedClip && edit(splitClip(visibleTimeline, selectedClip.id, visibleTimeline.playhead, uid()))}><ScissorsGlyph size={15} /></Button>
            <i aria-hidden />
            <Button variant="ghost" size="icon" className="bezier-tooltip" data-tooltip={cn().ui.zoomOut} data-tooltip-placement="top" aria-label={cn().ui.zoomOut} disabled={zoom <= 1 || Boolean(gesture)} onClick={() => setZoom(value => Math.max(1, value / 2))}><Minus aria-hidden size={14} strokeWidth={1.7} /></Button>
            <span>{zoom}×</span>
            <Button variant="ghost" size="icon" className="bezier-tooltip" data-tooltip={cn().ui.zoomIn} data-tooltip-placement="top" aria-label={cn().ui.zoomIn} disabled={zoom >= 16 || Boolean(gesture)} onClick={() => setZoom(value => Math.min(16, value * 2))}><Plus aria-hidden size={14} strokeWidth={1.7} /></Button>
          </div>
        </div>
      </> : null}
      <div className={detailed ? styles.timelineScroll : undefined}>
      <div style={detailed ? { minWidth: `${zoom * 100}%` } : undefined}>
      <div ref={timelineElement} className="clip-timeline nodrag nopan nowheel">
        <div className="clip-ruler-row">
          <button type="button" className="clip-add-button" disabled={busy} onClick={() => setResourcePickerOpen(true)} aria-label={cn().actions.addClipMedia} aria-haspopup="dialog" aria-expanded={resourcePickerOpen}><Icon name="plus" size={19} /></button>
          <div className="clip-ruler" data-clip-ruler onPointerDown={event => begin(event, 'scrub')}>
            {marks.map(mark => <span className="clip-ruler-mark" key={mark} style={{ left: `${mark / scaleDuration * 100}%` }}>{formatTime(mark, rulerStep < 1)}</span>)}
            {(visibleTimeline.markers || []).map(marker => <button key={marker.id} type="button" className="clip-timeline-marker" style={{ left: `${marker.time / scaleDuration * 100}%` }} title={cn().ui.markerAria(marker.label, formatTime(marker.time))} onClick={event=>{event.stopPropagation();edit({...visibleTimeline,playhead:marker.time});}} onDoubleClick={event=>{event.stopPropagation();edit({...visibleTimeline,markers:(visibleTimeline.markers || []).filter(item=>item.id!==marker.id)});}}><span>{marker.label}</span></button>)}
            {total > 0 ? <div className="clip-playhead-label" role="slider" tabIndex={0} aria-label={cn().ui.playhead} aria-valuemin={0} aria-valuemax={total} aria-valuenow={Number(visibleTimeline.playhead.toFixed(2))} aria-valuetext={formatTime(visibleTimeline.playhead)} style={{ left: `clamp(0px, ${visibleTimeline.playhead / scaleDuration * 100}%, calc(100% - 66px))` }} onPointerDown={event => begin(event, 'scrub')}>{formatTime(visibleTimeline.playhead)}</div> : null}
            {editTime !== undefined ? <div className="clip-playhead-label clip-edit-label" style={{ left: `clamp(0px, ${editTime / scaleDuration * 100}%, calc(100% - 66px))` }}>{formatTime(editTime)}</div> : null}
          </div>
        </div>
        {detailed ? (
          <>
            {renderNewTrack()}
            {Array.from({ length: videoTrackCount }, (_, index) => renderTrack(visualClips.filter(clip => (clip.track || 0) === index), cn().ui.pictureN(index + 1), index)).reverse()}
            {Array.from({ length: audioTrackCount }, (_, index) => renderTrack(audioClips.filter(clip => (clip.track || 0) === index), cn().ui.audioN(index + 1), index)).reverse()}
          </>
        ) : total > 0 ? (
          <>
            {Array.from({ length: videoTrackCount }, (_, index) => renderTrack(visualClips.filter(clip => (clip.track || 0) === index), cn().ui.pictureN(index + 1), index)).reverse()}
            {Array.from({ length: audioTrackCount }, (_, index) => renderTrack(audioClips.filter(clip => (clip.track || 0) === index), cn().ui.audioN(index + 1), index)).reverse()}
          </>
        ) : (
          <button type="button" className="clip-empty" onClick={() => setResourcePickerOpen(true)}>{cn().ui.connectOrAdd}</button>
        )}
        {total > 0 ? (
          <div className="clip-node-footer">
            <Button variant="ghost" size="icon" aria-label={playing ? cn().ui.pausePreview : cn().ui.playPreview} title={cn().ui.playPauseSpace} disabled={!total} onClick={togglePlayback}><span aria-hidden>{playing ? 'Ⅱ' : '▶'}</span></Button>
            <span>{formatTime(visibleTimeline.playhead)} / {formatTime(total)}</span>
            {selectedClip ? <span className={`clip-selection-timing${gesture?.clipId ? ' is-editing' : ''}`} data-clip-timing title={cn().ui.sourceInHint(formatTime(selectedClip.sourceIn))}>
              {gesture?.mode === 'move' ? cn().labels.move : gesture?.clipId ? cn().labels.trim : cn().labels.clip} {formatTime(selectedClip.start)} → {formatTime(selectedClip.start + selectedClip.duration)} <b>{cn().labels.duration} {formatTime(selectedClip.duration)}</b>{gesture?.snap !== undefined ? cn().labels.snapped : ''}
            </span> : null}
            {message ? <span className="clip-node-message" role="status" title={message}>{message}</span> : null}
          </div>
        ) : null}
      </div>
      </div>
      </div>
      <ImageReferenceResourcePicker
        open={resourcePickerOpen}
        resources={data.canvasMediaResources || []}
        acceptedKinds={['image', 'video', 'audio']}
        initialSource="library"
        onClose={() => setResourcePickerOpen(false)}
        onUseCanvas={addCanvasResources}
        onUseLibrary={files => addFiles(files)}
        onUpload={files => addFiles(Array.from(files || []))}
      />
      {exportOpen ? createPortal(<div className="clip-detailed-scope nodrag nopan"><ClipExportPanel timeline={visibleTimeline} title={item.title || cn().labels.timeline} controller={exportController} onClose={() => setExportOpen(false)} /></div>, document.fullscreenElement || document.body) : null}
      {!detailed ? <Handle type="target" position={Position.Left} className="basic-node-handle basic-node-handle-target" /> : null}
    </article>
  );
}
