'use client';
import {CanvasImageTools} from './CanvasImageTools';
import { CanvasErrorNotice } from './CanvasErrorNotice';
import { defaultVisualModel, isVisualModelEnabled } from './visual-model-routing';
import { useCanvasImageModels } from '../platform/media-catalog';
import { MessageSquarePlus } from 'lucide-react';
import { CanvasSaveAssetButton } from './CanvasSaveAssetButton';
import { ian } from '../locales/image-asset-node';

import React from 'react';
import { ImageCanvasCard } from '@ks-designai/image-card-pack/react';
import { Icon } from '../ui/Icon';
import { ImageReferenceResourcePicker, type CanvasReferenceResource } from './ImageReferenceResourcePicker';
import type { CanvasResultSnapshot,CanvasImageReference } from '@bezier/contracts';
import { ImageGenerationError } from './ImageGenerationError';
import { CanvasPreviewImage } from './CanvasPreviewImage';
import { Button, Select } from '@bezier/components';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { resolveCanvasImageSrc, projectFileUrl } from '../platform/api-base';
import { setImageGroupHot, scheduleClearImageGroupHot } from './imageGroupHot';
import { ImageCropTool as CropEditor, ImageAdjustTool as ImageAdjustOverlay, ImageTransformTool, ImageLayerTool } from '@ks-designai/image-card-pack/react';
import ImageEditorView from './ImageEditorView';
import type { CanvasNodeCreationKind } from './canvas-node-catalog';
import { CanvasNodeSourceHandle } from './CanvasNodeSourceHandle';
import { CanvasNodeActions } from './CanvasNodeActions';
import { CompositionSafeTextarea } from './CompositionSafeField';
import {
  CanvasComposerAttachment,
  CanvasComposerHeader,
  CanvasComposerShell,
  openCanvasProjectAssets,
} from './CanvasComposerChrome';

const MAX_W = 420;
const MAX_H = 360;

export type WorkbenchImage = {
  /** Independent App resource; Canvas stores only reference and display data. */
  imageReference?:CanvasImageReference;
  /** Image stacking rank within its canvas parent. */
  zIndex?: number;
  /** Original native-media inputs for an explicit new attempt, never an automatic replay. */
  mediaRequest?: Record<string, unknown>;
  mediaDelivery?: Record<string, unknown>;
  /** Unsubmitted controls, independent of generated output metadata. */
  generationDraft?: ContinueGenerateParams;
  id: string;
  src?: string;
  path?: string;
  /** Retained snapshots for legacy data and storyboard edits, never ordinary image version UI. */
  resultHistory?: CanvasResultSnapshot[];
  replacementRequestId?: string;
  name: string;
  x: number;
  y: number;
  naturalWidth?: number;
  naturalHeight?: number;
  status?: 'ready' | 'generating' | 'failed';
  taskId?: string;
  slotId?: string;
  ratio?: '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
  model?: string;
  variant?: string;
  outputIndex?: number;
  prompt?: string;
  negativePrompt?: string;
  resolution?: '2K' | '4K';
  error?: string;
  /** 生图结果所属的视觉母卡；手动导入图片无此字段。 */
  sourceInstanceId?: string;
  /** 首张生图结果直接显示在视觉母卡中，不再渲染为独立图片节点。 */
  embeddedInSource?: boolean;
  /** 继续生图时的直接父图；首代图片无此字段。 */
  parentImageId?: string;
  /** 参考图组继续生图时的直接父组。 */
  parentGroupId?: string;
  /** New outputs of a grouped card stay independent until explicitly regrouped. */
  excludeFromAutoGroup?: boolean;
  /** 所属参考图组；有值时 x/y 为相对组内坐标 */
  groupId?: string;
  assetKind?: 'generated' | 'cutout';
  /** Media-task id while this source is being cut out or while its derivative is pending. */
  cutoutTaskId?: string;
  /** Source node id retained by a transparent-background derivative. */
  cutoutSourceImageId?: string;
};

const RATIO_SIZE: Record<NonNullable<WorkbenchImage['ratio']>, { width: number; height: number }> = {
  '1:1': { width: 320, height: 320 },
  '3:4': { width: 270, height: 360 },
  '4:3': { width: 420, height: 315 },
  '9:16': { width: 203, height: 360 },
  '16:9': { width: 420, height: 236 },
};

export function getImageDisplaySize(naturalWidth?: number, naturalHeight?: number) {
  const w = naturalWidth || 320;
  const h = naturalHeight || 240;
  const scale = Math.min(1, MAX_W / w, MAX_H / h);
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

export type ImageAssetData = {
  onOpenApp?: (id: string) => Promise<void>;
  referenceResources?: CanvasReferenceResource[];
  onUploadReference?: (file: File) => Promise<{ path: string; src?: string }>;
  image: WorkbenchImage;
  onDraftChange?: (id: string, draft: ContinueGenerateParams) => void;
  displaySize?: { width: number; height: number };
  composerOwnerId?: string;
  onNaturalSize?: (width: number, height: number) => void;
  toast?: string;
  promptOpen?: boolean;
  /** 该图正在提交裁剪结果 */
  cropSaving?: boolean;
  /** The source node has an active transparent-background task. */
  cutoutBusy?: boolean;
  onReplace: (id: string, file: File) => void;
  onDownload: (id: string) => void;
  onGenerate: (id: string, params: ContinueGenerateParams) => void | Promise<void>;
  onTogglePrompt: (id: string) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onRetry: (id: string) => void;
  onRotate: (id: string) => void;
  onLayer?: (id: string, direction: 'front' | 'back' | 'up' | 'down') => void;
  onCutout: (id: string) => void;
  onAddToChat: (id: string) => void;
  onSendAnnotatedToAI: (id: string, file: File, instruction: string) => void | Promise<void>;
  onAddConnectedNode: (sourceId: string, kind: ImageConnectedNodeKind, origin: ImageConnectedNodeOrigin) => void;
  /** 画布内裁剪完成：直接用裁剪结果替换本节点图片 */
  onCropCommit: (id: string, file: File, meta: { width: number; height: number }) => boolean | void | Promise<boolean | void>;
  /** 标注属于派生版本：保留原图，在右侧创建新图片并连线。 */
  onAnnotationCommit: (id: string, file: File, meta: { width: number; height: number }) => boolean | void | Promise<boolean | void>;
};

export type ContinueGenerateParams = {
  references?: Array<{ name: string; path: string; mimeType: string; size: number }>;
  models: string[];
  count: number;
  ratios: string[];
  resolution: string;
  prompt: string;
};

export type ImageConnectedNodeKind = CanvasNodeCreationKind;

export type ImageConnectedNodeOrigin = {
  /** Reference/shot image prompts already contain their scoped context. */
  skipSourceContext?: boolean;
  /** Initial instruction for a connected text generator; source content stays upstream. */
  textInstruction?: string;
  /** Skip the storyboard entry choice when the source action already defines the route. */
  storyboardEntryMode?: 'generate';
  title?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Optional storyboard seed when a shot materializes into an image generator. */
  prompt?: string;
  attachments?: Array<{ name: string; path: string; size: number; mimeType: string }>;
  imageRatio?: '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
};

const IMAGE_PROMPT_RATIOS = ['1:1', '3:4', '4:3', '9:16', '16:9'] as const;
const IMAGE_PROMPT_RESOLUTIONS = ['2K', '4K'] as const;

export function CropIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 2v13h13M2 5h13v13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AnnotateIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 14.5 13.2 5.3a1.8 1.8 0 0 1 2.5 2.5L6.5 17H4v-2.5ZM12 6.5l1.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function AdjustIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 4v12M10 4v12M16 4v12M2.5 7h3M8.5 13h3M14.5 9h3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="4" cy="7" r="1.6" fill="white" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="10" cy="13" r="1.6" fill="white" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="16" cy="9" r="1.6" fill="white" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function RotateIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M15.8 7.5A6.2 6.2 0 1 0 16 13M15.8 7.5V3.8m0 3.7h-3.7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CutoutIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 3.2c2.4 0 4.3 2 4.3 4.4v1.2c0 1.3.5 2.4 1.5 3.3l.5.5-2 2.1-1.1-1.1a5.4 5.4 0 0 1-6.4 0l-1.1 1.1-2-2.1.5-.5c1-.9 1.5-2 1.5-3.3V7.6c0-2.4 1.9-4.4 4.3-4.4Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M7.6 8.2h.1m4.5 0h.1M8.1 11.2c1 .7 2.8.7 3.8 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function ChatAddIcon() {
  return <MessageSquarePlus size={18} strokeWidth={1.75} aria-hidden="true" />;
}

export function imageFileUrl(path: string, version?: string | number) {
  const base = projectFileUrl(path);
  return version === undefined ? base : `${base}${base.includes('?') ? '&' : '?'}v=${encodeURIComponent(String(version))}`;
}

/**
 * 修正持久化在画布状态里的历史 `image.src`。
 *
 * 早期版本把裸 `/api/files?path=...` 直接写进了 canvas state。
 * 代码侧已统一走 `imageFileUrl`，但**存量数据无法回溯**，故渲染前兜一层。
 * `projectScopedUrl` 幂等：已是项目作用域或绝对 URL 都原样返回。
 */
export function resolveImageSrc(src: string | undefined): string {
  return resolveCanvasImageSrc(src);
}

function ImageAssetNodeComponent({ data, selected }: NodeProps<Node<ImageAssetData>>) {
  const {
    image,
    toast,
    cropSaving,
    onDownload,
    onGenerate,
    onRemove,
    onDuplicate,
    onRetry,
    onLayer,
    onCropCommit,
    onAddToChat,
    onSendAnnotatedToAI,
    onAddConnectedNode,
    onAnnotationCommit,
  } = data;
  const grouped = Boolean(image.groupId);
  const status = image.status || 'ready';
  const toolTarget = React.useRef<HTMLElement>(null);
  const [cropping, setCropping] = React.useState(false);
  const [adjusting, setAdjusting] = React.useState(false);
  const [layerOpen, setLayerOpen] = React.useState(false);
  const [transforming, setTransforming] = React.useState(false);
  const [annotating, setAnnotating] = React.useState(false);
  const [promptDraft, setPromptDraft] = React.useState(image.generationDraft?.prompt ?? image.prompt ?? '');
  const [referencePickerOpen, setReferencePickerOpen] = React.useState(false);
  const [extraReferences, setExtraReferences] = React.useState<NonNullable<ContinueGenerateParams['references']>>(image.generationDraft?.references || []);
  const [promptSubmitting, setPromptSubmitting] = React.useState(false);
  const [promptError, setPromptError] = React.useState('');
  React.useEffect(() => { setPromptError(''); }, [image.id]);
  const addReferences = (references: NonNullable<ContinueGenerateParams['references']>) => setExtraReferences(current => [...new Map([...current, ...references].map(ref => [ref.path, ref])).values()]);
  const uploadReferences = async (files: readonly File[]) => {
    try {
      if (!data.onUploadReference) throw new Error(ian().uploadUnsupported);
      if (files.some(file => !file.type.startsWith('image/'))) throw new Error(ian().pickImageRef);
      const refs = await Promise.all(files.map(async file => ({ ...await data.onUploadReference!(file), name: file.name, mimeType: file.type, size: file.size })));
      addReferences(refs); return true;
    } catch (error) { const reason = error instanceof Error ? error : new Error(ian().uploadFailed); setPromptError(reason.message); throw reason; }
  };
  const IMAGE_PROMPT_MODELS = useCanvasImageModels();
  const [promptModel, setPromptModel] = React.useState(image.generationDraft?.models[0] || image.model || defaultVisualModel());
  const [promptRatio, setPromptRatio] = React.useState<NonNullable<WorkbenchImage['ratio']>>(image.generationDraft?.ratios[0] as WorkbenchImage['ratio'] || image.ratio || '1:1');
  const [promptResolution, setPromptResolution] = React.useState<NonNullable<WorkbenchImage['resolution']>>(image.generationDraft?.resolution as WorkbenchImage['resolution'] || image.resolution || '2K');
  const [promptCount, setPromptCount] = React.useState(image.generationDraft?.count || 1);
  const [promptExpanded, setPromptExpanded] = React.useState(false);
  const [natural, setNatural] = React.useState({
    w: image.naturalWidth || 0,
    h: image.naturalHeight || 0,
  });

  React.useEffect(() => {
    setNatural({ w: image.naturalWidth || 0, h: image.naturalHeight || 0 });
  }, [image.src, image.naturalWidth, image.naturalHeight]);

  const display = React.useMemo(() => {
    if (data.displaySize) return data.displaySize;
    if (status !== 'ready' && image.ratio) return RATIO_SIZE[image.ratio];
    return getImageDisplaySize(natural.w, natural.h);
  }, [data.displaySize, image.ratio, natural, status]);

  const lastDraft = React.useRef(JSON.stringify({ prompt: promptDraft, models: [promptModel], ratios: [promptRatio],
    resolution: promptResolution, count: promptCount, references: extraReferences }));
  // Persist user edits only. Mounting a new image must not mutate its history snapshot.
  React.useEffect(() => {
    if(image.imageReference)return;
    const draft = { prompt: promptDraft, models: [promptModel], ratios: [promptRatio],
      resolution: promptResolution, count: promptCount, references: extraReferences };
    const serialized = JSON.stringify(draft);
    if (serialized === lastDraft.current) return;
    lastDraft.current = serialized;
    if (serialized !== JSON.stringify(image.generationDraft)) data.onDraftChange?.(image.id, draft);
  }, [promptDraft, promptModel, promptRatio, promptResolution, promptCount, extraReferences, image.id, image.generationDraft, image.imageReference, data.onDraftChange]);

  async function submitPrompt(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!promptDraft.trim() || promptSubmitting) return;
    if (!isVisualModelEnabled(promptModel)) { setPromptError(ian().modelUnconfigured(promptModel)); return; }
    setPromptSubmitting(true); setPromptError('');
    try { await onGenerate(image.id, {
      references: extraReferences,
      models: [promptModel],
      count: promptCount,
      ratios: [promptRatio],
      resolution: promptResolution,
      prompt: promptDraft.trim(),
    }); } catch (error) { setPromptError(error instanceof Error ? error.message : ian().generateFailed); }
    finally { setPromptSubmitting(false); }
  }

  function markGroupHot() {
    if (!image.groupId) return;
    setImageGroupHot(image.groupId);
  }

  function scheduleGroupCold() {
    if (!image.groupId) return;
    scheduleClearImageGroupHot();
  }

  return (
    <article ref={toolTarget}
      className={`image-asset-node is-${status} ${selected ? 'is-selected' : ''} ${grouped ? 'is-grouped' : ''}`}
      style={{ width: display.width }}
      onPointerEnter={markGroupHot}
      onPointerLeave={scheduleGroupCold}
    >
      <Handle type="target" position={Position.Left} className="node-handle" />
      {/* 组内选中成员复用下载/移出胶囊；直接复制/删除仍由组生命周期管理。 */}
      {(!grouped || selected) && (
        <CanvasNodeActions
          floating
          placement={selected ? 'inside' : 'outside'}
          onDownload={() => onDownload(image.id)}
          downloadDisabled={status !== 'ready' || !image.src || cropping || adjusting || transforming || annotating}
          downloadLabel={ian().downloadImage}
          onDuplicate={grouped ? undefined : () => onDuplicate(image.id)}
          onRemove={grouped ? undefined : () => onRemove(image.id)}
          duplicateLabel={ian().duplicateImage}
          removeLabel={ian().removeImage}
        >

        </CanvasNodeActions>
      )}
      <CanvasNodeSourceHandle onAddNode={kind => onAddConnectedNode(image.id, kind, {
        x: image.x,
        y: image.y,
        width: display.width,
        height: display.height,
      })} />

      <ImageCanvasCard
        className="image-asset-frame"
        style={{ width: display.width, height: display.height }}
        ready={status === 'ready' && Boolean(image.src)}
        preview={image.src ?
          <CanvasPreviewImage
            className="image-asset-media"
            previewSize={Math.max(display.width, display.height)}
            original={!image.naturalWidth || !image.naturalHeight}
            loading="lazy"
            decoding="async"
            src={resolveImageSrc(image.src)}
            alt={image.name}
            draggable={false}
            onLoad={event => {
              const w = event.currentTarget.naturalWidth;
              const h = event.currentTarget.naturalHeight;
              if (w && h && (w !== natural.w || h !== natural.h)) setNatural({ w, h });
              if (w && h && (w !== image.naturalWidth || h !== image.naturalHeight)) data.onNaturalSize?.(w, h);
            }}
          /> : null
        }
        pending={
          <div className="image-generation-state">
            {status === 'generating' ? (
              <>
                <span className="image-generation-orbit" aria-hidden="true" />
                <strong>{ian().generating}</strong>
                <span>{[image.variant, image.model, image.outputIndex ? ian().outputIndex(image.outputIndex) : ''].filter(Boolean).join(' · ')}</span>
              </>
            ) : (
              <>
                <span className="image-generation-failed" aria-hidden="true">!</span>
                <strong>{ian().generateFailedTitle}</strong>
                <ImageGenerationError error={image.error || ian().generateFailedBody} onRetry={() => onRetry(image.id)} />
              </>
            )}
          </div>
        }
      >

        {selected && !image.imageReference && status === 'ready' && image.src && !cropping && !adjusting && !transforming && !annotating && !layerOpen && <CanvasImageTools
          onRender={async(file,meta)=>{if(await onAnnotationCommit(image.id,file,meta)===false)throw Error('图片云端保存失败');}} nodeId={image.id} src={resolveImageSrc(image.src)} name={image.name} width={image.naturalWidth || natural.w} height={image.naturalHeight || natural.h}
          target={() => toolTarget.current?.querySelector<HTMLElement>('.image-asset-frame') ?? toolTarget.current}
          onCrop={() => setCropping(true)} onAdjust={() => setAdjusting(true)} onTransform={() => setTransforming(true)} onAnnotate={() => setAnnotating(true)}
          {...(onLayer ? {onLayer:() => setLayerOpen(true)} : {})} onDownload={() => onDownload(image.id)} onAddToChat={() => onAddToChat(image.id)} extra={<CanvasSaveAssetButton presentation="menu-item" nodeId={image.id}/>}
        />}

        {layerOpen && onLayer && <ImageLayerTool target={() => toolTarget.current?.querySelector<HTMLElement>('.image-asset-frame') ?? toolTarget.current} onLayer={direction => onLayer(image.id, direction)} onClose={() => setLayerOpen(false)} />}

        {transforming && status === 'ready' && image.src && (
          <ImageTransformTool target={() => toolTarget.current?.querySelector<HTMLElement>('.image-asset-frame, .minimax-image-frame') ?? toolTarget.current} src={resolveImageSrc(image.src)} name={image.name} busy={cropSaving}
            onCancel={() => setTransforming(false)} onCommit={(file, meta) => onCropCommit(image.id, file, meta)} />
        )}

        {adjusting && status === 'ready' && image.src && (
          <ImageAdjustOverlay target={() => toolTarget.current?.querySelector<HTMLElement>('.image-asset-frame, .minimax-image-frame') ?? toolTarget.current}
            src={resolveImageSrc(image.src)}
            name={image.name}
            busy={cropSaving}
            onCancel={() => setAdjusting(false)}
            onCommit={async (file, meta) => {
              if (await onCropCommit(image.id, file, meta) === false) return false;
              setAdjusting(false);
            }}
          />
        )}

        {annotating && status === 'ready' && image.src && (
          <ImageEditorView
            presentation="inline"
            src={resolveImageSrc(image.src)}
            name={image.name}
            saving={cropSaving}
            onClose={() => setAnnotating(false)}
            onCommit={async (file, meta) => {
              await onAnnotationCommit(image.id, file, meta);
              setAnnotating(false);
            }}
            onRegenerate={async (file, instruction) => {
              await onSendAnnotatedToAI(image.id, file, instruction);
              setAnnotating(false);
            }}
          />
        )}

        {cropping && status === 'ready' && image.src && (
          <CropEditor target={() => toolTarget.current?.querySelector<HTMLElement>('.image-asset-frame, .minimax-image-frame') ?? toolTarget.current}
            src={resolveImageSrc(image.src) || (image.path ? imageFileUrl(image.path) : '')}
            name={image.name}
            naturalWidth={image.naturalWidth || natural.w || display.width}
            naturalHeight={image.naturalHeight || natural.h || display.height}
            displayWidth={display.width}
            displayHeight={display.height}
            busy={cropSaving}
            onCancel={() => setCropping(false)}
            onCommit={async (file, meta) => {
              if (await onCropCommit(image.id, file, meta) === false) return false;
              setCropping(false);
            }}
          />
        )}

        {status === 'ready' && (promptError
          ? <CanvasErrorNotice placement="card" error={promptError} />
          : image.error && <ImageGenerationError placement="card" error={image.error} onRetry={() => onRetry(image.id)} />)}
        {toast && <span className="image-asset-toast nodrag nopan">{toast}</span>}
      </ImageCanvasCard>

      {selected && !image.imageReference && status === 'ready' && image.src && !cropping && !adjusting && !transforming && !annotating && (
        <CanvasComposerShell
          ownerId={data.composerOwnerId || image.id}
          expanded={promptExpanded}
          className="image-asset-prompt-composer"
          onSubmit={submitPrompt}
          data-action-ui-id="image-asset-prompt-composer"
        >
          <CanvasComposerHeader
            attachmentsLabel={ian().references}
            addLabel={ian().addReference}
            onAdd={data.referenceResources ? () => setReferencePickerOpen(true) : openCanvasProjectAssets}
            expanded={promptExpanded}
            onExpand={() => setPromptExpanded(value => !value)}
          >
            <CanvasComposerAttachment name={image.name || ian().currentImage} mimeType="image/png" src={resolveImageSrc(image.src)} className="is-source" />
            {extraReferences.map(ref => <CanvasComposerAttachment key={ref.path} name={ref.name} mimeType={ref.mimeType} src={imageFileUrl(ref.path)}><Button type="button" variant="ghost" size="icon" aria-label={ian().removeRefNamed(ref.name)} onClick={() => setExtraReferences(current => current.filter(item => item.path !== ref.path))}><Icon name="close" /></Button></CanvasComposerAttachment>)}
          </CanvasComposerHeader>
          {referencePickerOpen && <ImageReferenceResourcePicker open resources={data.referenceResources || []} onClose={() => setReferencePickerOpen(false)} onUseCanvas={ids => { addReferences((data.referenceResources || []).filter(r => ids.includes(r.id) && r.path).map(r => ({ name: r.name, path: r.path!, mimeType: r.mimeType || 'image/png', size: 0 }))); setReferencePickerOpen(false); }} onUseLibrary={files => uploadReferences(files)} onUpload={files => uploadReferences(Array.from(files || []))} />}
          <div className="minimax-image-prompt-wrap">
            <CompositionSafeTextarea
              value={promptDraft}
              maxLength={7500}
              placeholder={ian().promptPlaceholder}
              aria-label={ian().promptAria}
              onValueChange={setPromptDraft}
              onKeyDown={event => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <span className="minimax-image-prompt-count">{promptDraft.length} / 7500</span>
          </div>
          <div className="minimax-image-toolbar">
            <div className="minimax-image-toolbar-left">
              <label className="minimax-image-chip image-prompt-select-chip">
                <Select aria-label={ian().selectModel} value={promptModel} onChange={event => setPromptModel(event.target.value)}>
                  {!IMAGE_PROMPT_MODELS.some(option => option.value === promptModel) && <option value={promptModel} disabled>{ian().modelUnconfigured(promptModel)}</option>}
                  {IMAGE_PROMPT_MODELS.filter(option => isVisualModelEnabled(option.value)).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Select>
              </label>
              <span className="minimax-image-divider" aria-hidden="true" />
              <label className="minimax-image-chip image-prompt-select-chip is-ratio">
                <span className="minimax-ratio-icon" aria-hidden="true" style={{ aspectRatio: promptRatio.replace(':', ' / ') }} />
                <Select aria-label={ian().selectRatio} value={promptRatio} onChange={event => setPromptRatio(event.target.value as NonNullable<WorkbenchImage['ratio']>)}>
                  {IMAGE_PROMPT_RATIOS.map(ratio => <option key={ratio} value={ratio}>{ratio}</option>)}
                </Select>
              </label>
              <label className="minimax-image-chip image-prompt-select-chip">
                <Select aria-label={ian().selectResolution} value={promptResolution} onChange={event => setPromptResolution(event.target.value as NonNullable<WorkbenchImage['resolution']>)}>
                  {IMAGE_PROMPT_RESOLUTIONS.map(resolution => <option key={resolution} value={resolution}>{resolution}</option>)}
                </Select>
              </label>
              <span className="minimax-image-divider" aria-hidden="true" />
              <label className="minimax-image-chip image-prompt-select-chip is-count">
                <span aria-hidden="true">×</span>
                <Select aria-label={ian().generateCount} value={promptCount} onChange={event => setPromptCount(Number(event.target.value))}>
                  {[1, 2, 3, 4].map(count => <option key={count} value={count}>{count}</option>)}
                </Select>
              </label>
            </div>
            <div className="minimax-image-toolbar-right">
              <Button type="submit" variant="primary" size="icon" className="minimax-image-submit" disabled={!promptDraft.trim() || promptSubmitting} aria-label={ian().generateImage} title={promptDraft.trim() ? ian().generateImage : ian().needPrompt}>
                <span aria-hidden="true">↑</span>
              </Button>
            </div>
          </div>
        </CanvasComposerShell>
      )}
    </article>
  );
}

export const ImageAssetNode = React.memo(ImageAssetNodeComponent,
  (previous, next) => previous.data === next.data && previous.selected === next.selected);

export function buildImageNode(args: {
  image: WorkbenchImage;
  toast?: string;
  promptOpen?: boolean;
  cropSaving?: boolean;
  cutoutBusy?: boolean;
  callbacks: Omit<ImageAssetData, 'image' | 'toast' | 'promptOpen' | 'cropSaving' | 'cutoutBusy'>;
}): Node<ImageAssetData> {
  return {
    id: args.image.id,
    type: 'imageAsset',
    zIndex: args.image.zIndex ?? 0,
    position: { x: args.image.x, y: args.image.y },
    parentId: args.image.groupId,
    draggable: true,
    selectable: true,
    dragHandle: '.image-asset-frame',
    data: {
      image: args.image,
      toast: args.toast,
      promptOpen: args.promptOpen,
      cropSaving: args.cropSaving,
      cutoutBusy: args.cutoutBusy,
      ...args.callbacks,
    },
  };
}
