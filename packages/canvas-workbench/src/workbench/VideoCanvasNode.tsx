'use client';
import { localizeDaemonMessage } from '../locales/daemon-messages';
import { vn } from '../locales/video-node';
import styles from './VideoCanvasNode.module.css';
import { CanvasErrorNotice } from './CanvasErrorNotice';
import { PROJECT_LAYOUT, projectLayoutPath, videoGenerationLengths } from '@bezier/contracts';import { CanvasSaveAssetButton } from './CanvasSaveAssetButton';
import { useCanvasUiHost } from '../platform/ui-host';

import React from 'react';
import { useCanvasMediaCatalog } from '../platform/media-catalog';
import { useCanvasFlush } from '../platform/canvas-compat';
import { useCanvasMediaSubmission } from '../platform/media-submission';
import { useCanvasRenderDetail } from './CanvasRenderPolicy';
import { loadVideoPoster } from './video-poster';
import { Button, Select } from '@bezier/components';
import type { MediaTaskResumeRequest, ProjectMediaTasksResponse } from '@bezier/contracts';
import { platformFetch, projectFetch, projectFileUrl } from '../platform/api-base';
import { type BasicCanvasNodeData, type CanvasVideoResult } from './BasicCanvasNode';
import { CanvasHostedDialog } from '../platform/ui-host';
import { Icon } from '../ui/Icon';
import { CompositionSafeTextarea } from './CompositionSafeField';
import { CanvasOutputFrame, CanvasOutputNode, CanvasOutputStatus } from './CanvasOutputNode';
import { getVideoFrameSize, imageAspectFromDimensions, isLegacyVideoFrameSize, VIDEO_FRAME_SIZES } from './video-frame-size';
import { VIDEO_GENERATION_MODES } from './VideoGenerationOptionControls';
import { VideoCameraMoveControl } from './VideoCameraMoveControl';
import { videoCameraMoveInstruction } from './video-camera-move';
import {
  CanvasComposerAttachment,
  CanvasComposerHeader,
  CanvasComposerShell,
  openCanvasProjectAssets,
} from './CanvasComposerChrome';

type VideoModel = {
  id: string;
  label: string;
  hint?: string;
  provider: string;
  caps: string[];
  default?: boolean;
};

type MediaCatalog = {
  providers?: Array<{ id: string; label: string; integrated?: boolean }>;
  video?: VideoModel[];
  aspects?: string[];
  videoLengthsSec?: number[];
};

type MediaConfig = {
  providers?: Record<string, { configured?: boolean }>;
};

type VideoMode = NonNullable<BasicCanvasNodeData['node']['videoMode']>;

const VIDEO_DRAG_CANCEL_DISTANCE = 6;
type VideoPointerGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  moved: boolean;
};

const VIDEO_MODES = VIDEO_GENERATION_MODES;
function supportsMode(model: VideoModel, mode: VideoMode): boolean {
  return model.caps.includes(VIDEO_MODES.find(value => value.id === mode)!.cap);
}

const FALLBACK_MODEL: VideoModel = {
  id: 'doubao-seedance-2-0-260128',
  label: 'Seedance 2.0',
  hint: 'Volcengine video generation',
  provider: 'volcengine',
  caps: ['t2v', 'i2v', 'firstlast'],
};
const FALLBACK_ASPECTS = ['16:9', '9:16', '1:1'];
function providerLabel(catalog: MediaCatalog | null, model: VideoModel | undefined): string {
  if (!model) return vn().labels.videoModel;
  return catalog?.providers?.find(provider => provider.id === model.provider)?.label ?? model.provider;
}

function mergeResults(results: readonly CanvasVideoResult[] | undefined, next?: CanvasVideoResult): CanvasVideoResult[] {
  const byId = new Map<string, CanvasVideoResult>();
  for (const result of results ?? []) byId.set(result.id, result);
  if (next) byId.set(next.id, next);
  return [...byId.values()].sort((left, right) => left.createdAt - right.createdAt);
}

async function readTextSources(data: BasicCanvasNodeData): Promise<string[]> {
  const sources = (data.node.linkedAttachments ?? []).filter(attachment => !attachment.mimeType.startsWith('image/'));
  const resolved = await Promise.all(sources.map(async attachment => {
    if (attachment.content !== undefined) return attachment.content.trim();
    const response = await fetch(projectFileUrl(attachment.path));
    if (!response.ok) throw new Error(vn().errors.readUpstreamFailed(attachment.name));
    return (await response.text()).trim();
  }));
  return resolved.filter(Boolean);
}

async function generationPrompt(data: BasicCanvasNodeData): Promise<string> {
  const sourceTexts = await readTextSources(data);
  const instruction = data.node.text?.trim() ?? '';
  const content = !sourceTexts.length
    ? instruction
    : !instruction
      ? sourceTexts.join('\n\n')
      : vn().ui.withInstruction(sourceTexts.join('\n\n'), instruction);
  const camera = videoCameraMoveInstruction(data.node.videoCameraMove);
  return camera ? `${content}\n\n${camera}`.trim() : content;
}

function resultFromLegacyTask(data: BasicCanvasNodeData): CanvasVideoResult | undefined {
  const task = data.node.videoTask;
  if (task?.status !== 'done' || !task.path) return undefined;
  return {
    id: task.id,
    path: task.path,
    // Keep rehydrated legacy results stable across renders while still sorting
    // them after any explicitly timestamped history entries.
    createdAt: task.createdAt ?? Number.MAX_SAFE_INTEGER,
    model: task.model ?? data.node.videoModel ?? FALLBACK_MODEL.id,
    aspect: task.aspect ?? data.node.videoAspect ?? '16:9',
    length: task.length ?? data.node.videoLength ?? 5,
    resolution: task.resolution ?? data.node.videoResolution ?? '720p',
  };
}

export function VideoCanvasNode({ data, selected }: { data: BasicCanvasNodeData; selected?: boolean }) {
  const media = useCanvasMediaCatalog();
  if (media.ready && !media.video.length) {
    const results = mergeResults(data.node.videoResults, resultFromLegacyTask(data));
    const result = results.find(value => value.id === data.node.activeVideoResultId) ?? results.at(-1);
    return (
      <CanvasOutputNode className="video-asset-node" selected={selected} title={data.node.title || vn().labels.video}
        icon={<Icon name="video" size={16} />} onRemove={() => data.onRemove(data.node.id)}
        minWidth={280} minHeight={158} keepAspectRatio
        onResizeEnd={(width, height) => data.onPatch(data.node.id, { width, height })}
        sourceOrigin={{ x: data.node.x, y: data.node.y, width: data.node.width || 384, height: data.node.height || 216, attachments: data.node.linkedAttachments }}
        onAddConnectedNode={(kind, origin) => data.onAddConnectedNode(data.node.id, kind, origin)}
        onDuplicate={() => data.onDuplicate(data.node.id)}>
        <CanvasOutputFrame state={result ? 'preview' : 'empty'}>
          {result ? (
            <video className="video-node-media nodrag nopan nowheel" aria-label={vn().labels.generatedVideo}
              controls playsInline preload="metadata" src={projectFileUrl(result.path)}
              onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} />
          ) : (
            <div className={styles.unconfiguredEmpty} aria-label={vn().ui.previewArea}>
              <Icon name="video" size={48} />
              <p role="status">{vn().errors.noVideoModel}</p>
            </div>
          )}
        </CanvasOutputFrame>
        {result && selected && <p className={styles.unconfiguredNotice} role="status">{vn().errors.noVideoModel}</p>}
      </CanvasOutputNode>
    );
  }
  return <EnabledVideoCanvasNode data={data} selected={selected} />;
}

function EnabledVideoCanvasNode({ data, selected }: { data: BasicCanvasNodeData; selected?: boolean }) {
  const uiHost = useCanvasUiHost();
  const media = useCanvasMediaCatalog();
  const flushCanvas = useCanvasFlush();
  const submitMedia = useCanvasMediaSubmission();
  const { detail, nearby } = useCanvasRenderDetail();
  const [playbackRequested, setPlaybackRequested] = React.useState(false);
  const [poster, setPoster] = React.useState<{ src: string; image: string }>();
  const showPlayer = detail || playbackRequested;
  const item = data.node;
  const frameSize = getVideoFrameSize(item.videoAspect);
  const task = item.videoTask;
  const busy = task?.status === 'running';
  const [submissionInFlight, setSubmitting] = React.useState(false);
  const [acceptedTaskId, setAcceptedTaskId] = React.useState<string | null>(null);
  const submitting = submissionInFlight || Boolean(acceptedTaskId && task?.id !== acceptedTaskId);
  React.useEffect(() => {
    if (acceptedTaskId && task?.id === acceptedTaskId) setAcceptedTaskId(null);
  }, [acceptedTaskId, task?.id]);
  const submittingRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const [note, setNote] = React.useState('');
  const [catalog, setCatalog] = React.useState<MediaCatalog | null>(null);
  const [config, setConfig] = React.useState<MediaConfig | null>(null);
  const [catalogReady, setCatalogReady] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const videoGestureRef = React.useRef<VideoPointerGesture | null>(null);
  const suppressMediaClickRef = React.useRef(false);
  const patchRef = React.useRef(data.onPatch);
  patchRef.current = data.onPatch;
  const latestNodeRef = React.useRef(item);
  latestNodeRef.current = item;

  const handleVideoPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    videoGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  }, []);

  const handleVideoPointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = videoGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.moved) return;
    gesture.moved = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > VIDEO_DRAG_CANCEL_DISTANCE;
  }, []);

  const finishVideoPointer = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = videoGestureRef.current;
    if (gesture?.pointerId === event.pointerId && gesture.moved) {
      suppressMediaClickRef.current = true;
      window.setTimeout(() => { suppressMediaClickRef.current = false; }, 0);
    }
    videoGestureRef.current = null;
  }, []);

  const handleVideoClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (suppressMediaClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const video = videoRef.current;
    if (!video) { setPlaybackRequested(true); return; }
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, []);

  const legacyResult = resultFromLegacyTask(data);
  const results = mergeResults(item.videoResults, legacyResult);
  const activeResult = results.find(result => result.id === item.activeVideoResultId) ?? results.at(-1);
  const mediaSrc = activeResult ? projectFileUrl(activeResult.path) : '';
  React.useEffect(() => {
    if (!mediaSrc || showPlayer || !nearby) return;
    const controller = new AbortController();
    loadVideoPoster(mediaSrc, controller.signal).then(image => {
      if (!controller.signal.aborted) setPoster({ src: mediaSrc, image });
    }, () => {});
    return () => controller.abort();
  }, [mediaSrc, showPlayer, nearby]);
  React.useEffect(() => {
    if (playbackRequested) void videoRef.current?.play().catch(() => setPlaybackRequested(false));
  }, [playbackRequested]);
  const imageSources = (item.storyboardVideoFrames ?? item.linkedAttachments ?? []).filter(attachment => attachment.mimeType.startsWith('image/'));
  const textSources = (item.linkedAttachments ?? []).filter(attachment => !attachment.mimeType.startsWith('image/'));
  const requestedMode: VideoMode = item.videoMode
    ?? (imageSources.length > 1 ? 'firstlast' : imageSources.length === 1 ? 'i2v' : 't2v');

  React.useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      platformFetch('/api/media/models', { signal: controller.signal }),
      platformFetch('/api/media/config', { signal: controller.signal }),
    ]).then(async ([modelsResponse, configResponse]) => {
      if (modelsResponse.ok) setCatalog(await modelsResponse.json());
      if (configResponse.ok) setConfig(await configResponse.json());
    }).catch(() => {
      // Generation still has a deterministic provider fallback. A submit error
      // remains more useful than turning the whole card into a loading shell.
    }).finally(() => { if (!controller.signal.aborted) setCatalogReady(true); });
    return () => controller.abort();
  }, []);

  const configuredProviders = new Set(media.video.map(model => model.provider));
  // HyperFrames consumes a composition directory rather than this card's
  // prompt/image contract, so it belongs to its dedicated workflow surface.
  const catalogModels = media.video;
  // Settings and all canvas cards share one configuration-backed model list.
  const visibleModels = catalogModels;
  const preferredForMode = visibleModels.find(model => configuredProviders.has(model.provider) && model.default && supportsMode(model, requestedMode))
    ?? visibleModels.find(model => configuredProviders.has(model.provider) && supportsMode(model, requestedMode))
    ?? visibleModels.find(model => model.default && supportsMode(model, requestedMode))
    ?? visibleModels.find(model => supportsMode(model, requestedMode));
  const selectedModel = visibleModels.find(model => model.id === item.videoModel)
    ?? (item.videoModel ? { ...FALLBACK_MODEL, id: item.videoModel, label: vn().errors.modelUnconfigured(item.videoModel), provider: '', caps: [] } : undefined)
    ?? preferredForMode
    ?? FALLBACK_MODEL;
  const selectedProviderReady = media.ready && visibleModels.some(model => model.id === selectedModel.id);
  const supportsCurrentMode = supportsMode(selectedModel, requestedMode);
  const modeImageSources = requestedMode === 't2v'
    ? []
    : imageSources.slice(0, requestedMode === 'firstlast' ? 2 : 1);
  const firstFrameAspect = imageAspectFromDimensions(
    modeImageSources[0]?.naturalWidth,
    modeImageSources[0]?.naturalHeight,
  );
  const effectiveAspect = requestedMode === 't2v'
    ? item.videoAspect ?? '16:9'
    : firstFrameAspect ?? item.videoAspect ?? '16:9';
  const firstFrameUrl = item.videoFirstFrameUrl?.trim() ?? '';
  const lastFrameUrl = item.videoLastFrameUrl?.trim() ?? '';
  const hasRequiredImages = requestedMode === 't2v'
    || (requestedMode === 'i2v' && Boolean(modeImageSources[0] || firstFrameUrl))
    || (requestedMode === 'firstlast' && Boolean(
      (modeImageSources[0] || firstFrameUrl)
      && (modeImageSources[1] || lastFrameUrl),
    ));
  const canRetrieve = false;
  const hasPromptSource = Boolean(item.text?.trim() || textSources.length);
  const disabled = busy || submitting;
  const lengthOptions = videoGenerationLengths(selectedModel.id, catalog?.videoLengthsSec);  const generationLength = lengthOptions.includes(item.videoLength ?? 5) ? item.videoLength ?? 5 : lengthOptions[0]!;
  const consumedAutoRequest = React.useRef<string>();
  React.useEffect(() => {
    const request = item.videoSubmitRequestId;
    if (!request || request === consumedAutoRequest.current || !catalogReady || !media.ready) return;
    consumedAutoRequest.current = request;
    patchRef.current(item.id, { videoSubmitRequestId: undefined });
    if (disabled) return;
    if (!hasPromptSource || !supportsCurrentMode || !hasRequiredImages) { setNote(vn().errors.cannotAutoGen); return; }
    void generate();
  }, [item.videoSubmitRequestId, catalogReady, media.ready, disabled, hasPromptSource, supportsCurrentMode, hasRequiredImages]);

  React.useEffect(() => {
    if (!catalog || !config || !media.ready || !selectedProviderReady) return;
    if (item.videoModel === selectedModel.id) return;
    patchRef.current(item.id, { videoModel: selectedModel.id });
  }, [catalog, config, media.ready, selectedProviderReady, item.id, item.videoModel, selectedModel.id]);

  React.useEffect(() => {
    if (!isLegacyVideoFrameSize(item.width, item.height)) return;
    const frame = getVideoFrameSize(item.videoAspect);
    patchRef.current(item.id, frame);
  }, [item.height, item.id, item.videoAspect, item.width]);

  React.useEffect(() => {
    if (requestedMode === 't2v' || !firstFrameAspect || item.videoAspect === firstFrameAspect) return;
    patchRef.current(item.id, {
      videoAspect: firstFrameAspect,
      ...(VIDEO_FRAME_SIZES[firstFrameAspect] ?? {}),
    });
  }, [firstFrameAspect, item.id, item.videoAspect, requestedMode]);

  React.useEffect(() => {
    if (!busy || !task?.id || task.backendOwned) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await projectFetch(`/media/tasks?includeDone=1&taskIds=${encodeURIComponent(task!.id)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(vn().status.progressReconnect);
        const payload: ProjectMediaTasksResponse = await response.json();
        if (controller.signal.aborted || latestNodeRef.current.id !== item.id
          || latestNodeRef.current.videoTask?.id !== task!.id) return;
        const current = payload.tasks.find(value => value.taskId === task!.id);
        if (!current) throw new Error(vn().status.noTaskRecord);
        if (current.status === 'done') {
          const file = current.file as { name?: string; path?: string; size?: number; stub?: boolean; intentionalStub?: boolean; usedStubFallback?: boolean } | undefined;
          const path = file?.path || file?.name;
          if (!path || file?.size === 0 || file?.stub || file?.intentionalStub || file?.usedStubFallback) {
            patchRef.current(item.id, {
              videoTask: { ...task!, status: 'failed', error: vn().status.noRealVideo },
            });
            setNote('');
            return;
          }
          const result: CanvasVideoResult = {
            id: task!.id,
            path,
            createdAt: task!.createdAt ?? Date.now(),
            model: task!.model ?? item.videoModel ?? selectedModel.id,
            aspect: task!.aspect ?? item.videoAspect ?? '16:9',
            length: task!.length ?? item.videoLength ?? 5,
            resolution: task!.resolution ?? item.videoResolution ?? '720p',
          };
          patchRef.current(item.id, {
            videoTask: { ...task!, status: 'done', path, progress: current.progress },
            videoResults: mergeResults(latestNodeRef.current.videoResults ?? results, result),
            activeVideoResultId: result.id,
            projectFilePath: path,
            sourceMime: 'video/mp4',
          });
          setNote('');
          return;
        }
        if (current.status === 'failed' || current.status === 'interrupted') {
          setNote('');
          patchRef.current(item.id, {
            videoTask: {
              ...task!,
              status: 'failed',
              progress: current.progress,
              error: current.error?.message || vn().status.taskInterrupted,
            },
          });
          return;
        }
        const latestProgress = current.progress.at(-1) || vn().status.generating;
        setNote(localizeDaemonMessage(latestProgress));
        patchRef.current(item.id, { videoTask: { ...task!, progress: current.progress } });
      } catch (error) {
        if (controller.signal.aborted) return;
        setNote(error instanceof Error ? localizeDaemonMessage(error.message) : vn().status.reconnecting);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 3000);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [busy, item.id, task?.id]);

  async function generate(retrieve = false) {
    if (!retrieve && !selectedProviderReady) { setNote(vn().errors.configureModel); return; }
    if (submittingRef.current || disabled || !hasPromptSource || !supportsCurrentMode || !hasRequiredImages) return;
    submittingRef.current = true;
    setSubmitting(true);
    setNote(retrieve ? vn().status.retrieving : vn().status.submitting);
    try {
      const prompt = await generationPrompt(data);
      // Reading linked references can outlive deletion/navigation. Before
      // acceptance there is no provider job to recover, so do not start one.
      if (!mountedRef.current || latestNodeRef.current.id !== item.id) return;
      await flushCanvas();
      if (!mountedRef.current || latestNodeRef.current.id !== item.id) return;
      const requestId = crypto.randomUUID();
      const response = await submitMedia({
          clientRequestId: requestId,
          canvasDelivery: { nodeId: item.id, kind: 'video', basePath: item.projectFilePath || '', baseVersion: item.activeVideoResultId || '',
            fileUrl: projectFileUrl(projectLayoutPath(PROJECT_LAYOUT.videos, `${item.id}-${requestId}.mp4`)) },
          ...(retrieve ? { resumeTaskId: task!.id } satisfies MediaTaskResumeRequest : {}),
          surface: 'video',
          model: selectedModel.id,
          prompt,
          length: generationLength,
          resolution: item.videoResolution ?? '720p',
          aspect: effectiveAspect,
          ...(requestedMode === 'i2v'
            ? modeImageSources[0]
              ? { image: modeImageSources[0].path, images: [modeImageSources[0].path] }
              : firstFrameUrl
                ? { imageUrl: firstFrameUrl }
                : {}
            : {}),
          ...(requestedMode === 'firstlast'
            ? modeImageSources.length >= 2
              ? { image: modeImageSources[0]!.path, images: modeImageSources.slice(0, 2).map(source => source.path) }
              : firstFrameUrl && lastFrameUrl
                ? { imageUrls: [firstFrameUrl, lastFrameUrl] }
                : {}
            : {}),
          output: projectLayoutPath(PROJECT_LAYOUT.videos, `${item.id}-${crypto.randomUUID()}.mp4`),
          lineage: { sourceNodeIds: [item.id] },
      });
      const payload = await response.json();
      if (!response.ok || !payload.taskId) {
        throw new Error(typeof payload.error === 'string' ? payload.error : payload.error?.message || vn().status.submitFailed);
      }
      if (!mountedRef.current || latestNodeRef.current.id !== item.id) return;
      if (payload.canvasDeliveryOwned) { setAcceptedTaskId(payload.taskId); return; }
      const startedAt = Date.now();
      data.onPatch(item.id, {
        videoTask: {
          id: payload.taskId,
          status: 'running',
          model: selectedModel.id,
          aspect: effectiveAspect,
          length: generationLength,
          resolution: item.videoResolution ?? '720p',
          createdAt: startedAt,
          progress: [],
        },
        videoResults: results,
      });
    } catch (error) {
      setNote(error instanceof Error ? error.message : vn().status.submitFailedRetry);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const progressText = task?.progress?.at(-1);
  const statusText = busy
    ? note || (progressText ? localizeDaemonMessage(progressText) : '') || vn().status.generating
    : submitting
      ? note || vn().status.submitting
      : task?.status === 'failed'
        ? vn().status.genFailed
        : activeResult
          ? vn().status.done
          : vn().labels[VIDEO_MODES.find(mode => mode.id === requestedMode)!.labelKey];
  const taskError = task?.status === 'failed' && task.error ? localizeDaemonMessage(task.error) : '';
  const sourceModeError = !supportsCurrentMode
    ? vn().errors.modeUnsupported(selectedModel.label, vn().labels[VIDEO_MODES.find(mode => mode.id === requestedMode)!.labelKey])
    : !hasRequiredImages
      ? requestedMode === 'firstlast'
        ? vn().errors.needTwoImages
        : vn().errors.needOneImage
      : '';
  const providerError = !selectedProviderReady
    ? vn().errors.providerNotConfigured(providerLabel(catalog, selectedModel))
    : '';

  const downloadActive = () => {
    if (!activeResult) return;
    if (uiHost?.downloadResource) {
      void uiHost.downloadResource({ url: projectFileUrl(activeResult.path), fileName: activeResult.path, nodeId: item.id }).catch(error => setNote(error instanceof Error ? error.message : vn().errors.downloadFailed));
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = projectFileUrl(activeResult.path);
    anchor.download = activeResult.path.split('/').at(-1) || 'video.mp4';
    anchor.click();
  };

  return (
    <CanvasOutputNode
      className="video-asset-node"
      selected={selected}
      title={item.title || vn().labels.video}
      icon={<Icon name="video" size={16} />}
      minWidth={280}
      minHeight={158}
      keepAspectRatio
      onRemove={() => data.onRemove(item.id)}
      onDuplicate={() => data.onDuplicate(item.id)}
      onDownload={activeResult && !busy && !submitting ? downloadActive : undefined}
      downloadLabel={vn().ui.downloadVideo}
      onResizeEnd={(width, height) => data.onPatch(item.id, { width, height })}
      sourceOrigin={{
        x: item.x,
        y: item.y,
        width: item.width || frameSize.width,
        height: item.height || frameSize.height,
        attachments: item.linkedAttachments,
      }}
      onAddConnectedNode={(kind, origin) => data.onAddConnectedNode(item.id, kind, origin)}
    >
      <CanvasOutputFrame state={busy || submitting ? 'generating' : task?.status === 'failed' ? 'failed' : activeResult ? 'preview' : 'empty'}>
        {busy || submitting ? (
          <CanvasOutputStatus />
        ) : activeResult ? (<>
          {showPlayer ? <video
            ref={videoRef}
            className="video-node-media nopan nowheel"
            controls
            controlsList="nodownload"
            playsInline
            preload="metadata"
            src={mediaSrc}
            onPlay={() => setPlaybackRequested(true)}
            onPause={() => setPlaybackRequested(false)}
            onEnded={() => setPlaybackRequested(false)}
            aria-label={vn().labels.generatedVideo}
            onMouseDown={event => event.stopPropagation()}
            onPointerDown={event => event.stopPropagation()}
            onWheel={event => event.stopPropagation()}
          /> : poster?.src === mediaSrc ? <img className="video-node-media" src={poster.image} alt={vn().labels.videoPreview} decoding="async" /> : <div className="canvas-static-preview"><Icon name="video" size={48} /></div>}
          <div
            className="video-node-interaction-layer node-drag-surface nopan nowheel"
            role="button"
            tabIndex={0}
            aria-label={vn().ui.playOrScrub}
            onClick={handleVideoClick}
            onClickCapture={event => {
              if (!suppressMediaClickRef.current) return;
              event.preventDefault();
              event.stopPropagation();
            }}
            onPointerDown={handleVideoPointerDown}
            onPointerMove={handleVideoPointerMove}
            onPointerUp={finishVideoPointer}
            onPointerCancel={finishVideoPointer}
            onKeyDown={event => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              const video = videoRef.current;
              if (!video) return;
              if (video.paused) void video.play().catch(() => undefined);
              else video.pause();
            }}
            onWheel={event => event.stopPropagation()}
          />
        </>) : (
          <div className="basic-output-empty" aria-label={vn().ui.previewArea}>
            <Icon name="video" size={52} />
          </div>
        )}

        {!busy && !submitting && (providerError || sourceModeError || taskError || note) && (
          <CanvasErrorNotice placement="card" error={providerError || sourceModeError || taskError || note} />
        )}

        {activeResult && !busy && !submitting && selected && (
          <div className="image-action-capsule nodrag nopan">
            <CanvasSaveAssetButton nodeId={item.id} />
            <Button variant="ghost" className="has-label" aria-label={vn().labels.enlargePreview} title={vn().labels.enlargePreview} onClick={() => setPreviewOpen(true)}>
              <Icon name="eye" size={16} />
              <span>{vn().labels.preview}</span>
            </Button>
          </div>
        )}

        {results.length > 1 && selected && (
          <div className="basic-output-preview-nav nodrag nopan nowheel" aria-label={vn().labels.history} onWheel={event => event.stopPropagation()}>
            {results.map((result, index) => (
              <Button
                key={result.id}
                variant={activeResult?.id === result.id ? 'primary' : 'subtle'}
                size="icon"
                aria-label={vn().ui.viewResult(index + 1)}
                aria-pressed={activeResult?.id === result.id}
                onClick={() => data.onPatch(item.id, { activeVideoResultId: result.id, projectFilePath: result.path })}
              >
                {index + 1}
              </Button>
            ))}
          </div>
        )}
      </CanvasOutputFrame>

      {selected && (
        <CanvasComposerShell
          ownerId={item.id}
          expanded={expanded}
          className="basic-output-composer image-asset-prompt-composer video-node-composer"
          onSubmit={event => {
            event.preventDefault();
            void generate(canRetrieve);
          }}
          data-action-ui-id="video-generation-composer"
        >
          <div className={styles.modeBar} role="tablist" aria-label={vn().ui.genMode}>
            {VIDEO_MODES.map(mode => {
              const capableModel = visibleModels.find(model => configuredProviders.has(model.provider) && supportsMode(model, mode.id))
                ?? visibleModels.find(model => supportsMode(model, mode.id));
              return (
                <Button
                  key={mode.id}
                  type="button"
                  variant="ghost"
                  className={styles.modeButton}
                  role="tab"
                  aria-selected={requestedMode === mode.id}
                  disabled={disabled || !capableModel}
                  title={capableModel
                    ? configuredProviders.has(capableModel.provider)
                      ? vn().labels[mode.labelKey]
                      : vn().errors.modeNeedsProvider(vn().labels[mode.labelKey], providerLabel(catalog, capableModel))
                    : vn().errors.catalogNoMode(vn().labels[mode.labelKey])}
                  onClick={() => data.onPatch(item.id, {
                    videoMode: mode.id,
                    ...(capableModel && capableModel.id !== selectedModel.id ? { videoModel: capableModel.id } : {}),
                  })}
                >
                  {vn().labels[mode.labelKey]}
                </Button>
              );
            })}
          </div>

          <CanvasComposerHeader
            attachmentsLabel={vn().ui.upstreamAssets}
            addLabel={requestedMode === 't2v'
              ? vn().ui.addReferenceAssets
              : requestedMode === 'firstlast'
                ? vn().ui.addFirstLastImages
                : vn().ui.addReferenceImage}
            addDisabled={disabled}
            onAdd={openCanvasProjectAssets}
            expanded={expanded}
            onExpand={() => setExpanded(value => !value)}
          >
            {textSources.map(source => (
              <CanvasComposerAttachment key={`${source.path}-text`} name={source.name} mimeType={source.mimeType} className="is-linked" />
            ))}
            {requestedMode !== 't2v' && ([
              { role: 'first' as const, label: requestedMode === 'firstlast' ? vn().labels.firstFrame : '', url: firstFrameUrl, source: modeImageSources[0] },
              ...(requestedMode === 'firstlast'
                ? [{ role: 'last' as const, label: vn().labels.lastFrame, url: lastFrameUrl, source: modeImageSources[1] }]
                : []),
            ]).map(frame => {
              const src = frame.source ? projectFileUrl(frame.source.path) : frame.url || undefined;
              return src ? (
                <CanvasComposerAttachment
                  key={frame.role}
                  name={frame.source?.name || frame.url || frame.label}
                  mimeType="image/png"
                  src={src}
                  className="video-node-frame-attachment"
                >
                  {frame.label ? <span className="video-node-frame-label">{frame.label}</span> : null}
                </CanvasComposerAttachment>
              ) : null;
            })}
          </CanvasComposerHeader>

          <div className="minimax-image-prompt-wrap video-node-prompt-wrap">
            <CompositionSafeTextarea
              aria-label={vn().ui.description}
              maxLength={7500}
              placeholder={textSources.length ? vn().ui.optionalExtra : vn().ui.describePlaceholder}
              value={item.text ?? ''}
              disabled={disabled}
              onValueChange={text => data.onPatch(item.id, { text })}
              onKeyDown={event => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <span className="minimax-image-prompt-count">{(item.text ?? '').length} / 7500</span>
          </div>



          <div className="minimax-image-toolbar video-node-toolbar">
            <div className="minimax-image-toolbar-left video-node-toolbar-left">
              <label className="minimax-image-chip image-prompt-select-chip video-node-model-chip">
                <Select
                  aria-label={vn().labels.videoModel}
                  value={selectedModel.id}
                  disabled={disabled}
                  title={`${selectedModel.hint ?? selectedModel.label} · ${providerLabel(catalog, selectedModel)}`}
                  onChange={event => {
                    setNote('');
                    const nextModel = event.target.value;
                    data.onPatch(item.id, {
                      videoModel: nextModel,
                    });
                  }}
                >
                  {!visibleModels.some(model => model.id === selectedModel.id) && <option value={selectedModel.id} disabled>{selectedModel.label}{vn().ui.unavailable}</option>}
                  {visibleModels.map(model => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </Select>
              </label>
              <VideoCameraMoveControl
                value={item.videoCameraMove}
                disabled={disabled}
                onChange={videoCameraMove => data.onPatch(item.id, { videoCameraMove })}
              />
              <span className="minimax-image-divider" aria-hidden="true" />
              <label className="minimax-image-chip image-prompt-select-chip is-ratio">
                <span className="minimax-ratio-icon" aria-hidden="true" style={{ aspectRatio: effectiveAspect.replace(':', ' / ') }} />
                <Select
                  aria-label={vn().ui.aspect}
                  value={effectiveAspect}
                  disabled={disabled || requestedMode !== 't2v'}
                  title={requestedMode === 't2v' ? vn().ui.pickAspect : vn().ui.aspectFromFirst}
                  onChange={event => {
                    const aspect = event.target.value;
                    data.onPatch(item.id, { videoAspect: aspect, ...(VIDEO_FRAME_SIZES[aspect] ?? {}) });
                  }}
                >
                  {[...new Set([effectiveAspect, ...(catalog?.aspects?.length ? catalog.aspects : FALLBACK_ASPECTS)])]
                    .map(aspect => <option key={aspect}>{aspect}</option>)}
                </Select>
              </label>
              <label className="minimax-image-chip image-prompt-select-chip">
                <Select aria-label={vn().ui.resolution} value={item.videoResolution ?? '720p'} disabled={disabled} onChange={event => data.onPatch(item.id, { videoResolution: event.target.value })}>
                  <option value="720p">720p</option>
                  <option value="1080p">1080p</option>
                </Select>
              </label>
              <label className="minimax-image-chip image-prompt-select-chip">
                <Select aria-label={vn().ui.duration} value={String(generationLength)} title={item.videoLength !== undefined && generationLength !== item.videoLength ? vn().ui.lengthMismatch(item.videoLength, generationLength) : undefined} disabled={disabled} onChange={event => data.onPatch(item.id, { videoLength: Number(event.target.value) })}>
                  {lengthOptions.map(length => <option key={length} value={length}>{length} {vn().labels.seconds}</option>)}
                </Select>
              </label>
            </div>            <div className="minimax-image-toolbar-right">
              <Button
                type="submit"
                variant="primary"
                size="icon"
                className="minimax-image-submit video-node-generate-button"
                aria-label={busy ? vn().status.generatingShort : submitting ? vn().status.submittingShort : canRetrieve ? vn().status.retrieveResult : activeResult ? vn().status.generateAgain : vn().labels.generateVideo}
                title={busy ? statusText : canRetrieve ? vn().status.retrieveExisting : vn().labels.generateVideo}
                disabled={disabled || !hasPromptSource || !supportsCurrentMode || !hasRequiredImages || !selectedProviderReady}
              >
                {busy || submitting ? <span className="basic-output-spinner" aria-hidden="true" /> : <Icon name="arrow-up" size={16} />}
              </Button>
            </div>
          </div>
        </CanvasComposerShell>
      )}

      {previewOpen && activeResult ? (
        <CanvasHostedDialog open={previewOpen} onOpenChange={setPreviewOpen} className="video-node-preview-dialog" ariaLabel={vn().labels.videoPreview}>
          <div className="video-node-preview-dialog-header">
            <div><strong>{item.title || vn().labels.video}</strong><span>{activeResult.aspect} · {activeResult.length} {vn().labels.secondsDot} {activeResult.resolution}</span></div>
            <Button variant="ghost" size="icon" aria-label={vn().ui.closePreview} onClick={() => setPreviewOpen(false)}><Icon name="close" size={18} /></Button>
          </div>
          <video controls autoPlay playsInline src={projectFileUrl(activeResult.path)} aria-label={vn().ui.largePreview} />
        </CanvasHostedDialog>
      ) : null}

    </CanvasOutputNode>
  );
}
