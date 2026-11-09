'use client';
import { CanvasErrorNotice } from './CanvasErrorNotice';
import { useCanvasLocale } from '../platform/canvas-locale';
import { storyboardNodeCopy } from '../locales/storyboard-node';
import { STORYBOARD_SHOT_SIZES, STORYBOARD_CAMERA_MOVEMENTS, SHOT_SIZE_EXTREME_WIDE, SHOT_SIZE_WIDE, SHOT_SIZE_CLOSE, SHOT_SIZE_MEDIUM, CAMERA_MOVEMENT_PUSH } from '../locales/storyboard-enums';

import React from 'react';
import { CanvasSegmentedControl } from './CanvasSegmentedControl';
import { storyboardTableViewportHeight } from './storyboard-table-layout';
import { projectFileUrl } from '../platform/api-base';
import { AssetPopover, StoryboardShotAssets } from './StoryboardAssetsControl';
import { storyboardFrame, storyboardShotImages, selectedStoryboardShotImage } from './storyboard-shot-images';
import { ImageReferenceResourcePicker } from './ImageReferenceResourcePicker';
import { relatedStoryboardShots } from './storyboard-relations';
import { resolveStoryboardAsset, type StoryboardAssetLibrary } from './storyboard-assets';
import { Button, Input, Select } from '@bezier/components';
import {
  requireCanvasHoverCardRenderer,
  requireCanvasMenuRenderer,
  requireCanvasPopoverRenderer,
  useCanvasUiHost,
  useCanvasNodeOverlayPortalContainer,
} from '../platform/ui-host';
import { Icon } from '../ui/Icon';
import type { CanvasLinkedAttachment } from './canvas-linked-attachments';
import {
  CanvasComposerAttachment,
  CanvasComposerHeader,
  CanvasComposerShell,
  openCanvasProjectAssets,
} from './CanvasComposerChrome';
import { CanvasNodeStarter } from './CanvasNodeStarter';
import { CanvasSelectionItem } from './CanvasSelectionItem';
import { CompositionSafeInput, CompositionSafeTextarea } from './CompositionSafeField';
import { VideoCameraMoveControl } from './VideoCameraMoveControl';
import {
  DEFAULT_VIDEO_CAMERA_MOVE,
  videoCameraMoveSummary,
  type VideoCameraMove,
  type VideoCameraMoveId,
  type VideoCameraShot,
} from './video-camera-move';
import {
  createStoryboardShot,
  buildStoryboardShotPrompt,
  duplicateStoryboardShot,
  reorderStoryboardShot,
  removeStoryboardShot,
  storyboardDuration,
  type StoryboardCameraMovement,
  type StoryboardGenerationType,
  type StoryboardPlan,
  type StoryboardShot,
  type StoryboardShotSize,
} from './storyboard-card';

function useStoryboardCopy() {
  return storyboardNodeCopy(useCanvasLocale());
}

const SHOT_SIZES = STORYBOARD_SHOT_SIZES;

const STORYBOARD_TO_VIDEO_MOVE: Partial<Record<StoryboardCameraMovement, VideoCameraMoveId>> = {
  推进: 'push_in',
  拉远: 'pull_out',
  横移: 'track_right',
  跟拍: 'track_right',
  环绕: 'orbit_right',
};

function storyboardShotToVideoCameraMove(shot: StoryboardShot): VideoCameraMove | undefined {
  if (shot.cameraMove) return shot.cameraMove;
  const move = STORYBOARD_TO_VIDEO_MOVE[shot.cameraMovement];
  if (!move) return undefined;
  const videoShot: VideoCameraShot = shot.shotSize === SHOT_SIZE_EXTREME_WIDE || shot.shotSize === SHOT_SIZE_WIDE
    ? 'wide'
    : shot.shotSize === SHOT_SIZE_MEDIUM
      ? 'medium'
      : 'close';
  return { ...DEFAULT_VIDEO_CAMERA_MOVE, move, shot: videoShot };
}

function videoMoveToStoryboardMovement(move: VideoCameraMoveId): StoryboardCameraMovement {
  if (move === 'push_in' || move === 'zoom_in') return CAMERA_MOVEMENT_PUSH;
  if (move === 'pull_out' || move === 'zoom_out' || move === 'dolly_zoom') return STORYBOARD_CAMERA_MOVEMENTS[2];
  if (move === 'orbit_left' || move === 'orbit_right') return STORYBOARD_CAMERA_MOVEMENTS[5];
  if (move === 'crane_up' || move === 'crane_down') return STORYBOARD_CAMERA_MOVEMENTS[4];
  return STORYBOARD_CAMERA_MOVEMENTS[3];
}

function videoShotToStoryboardShotSize(shot: VideoCameraShot): StoryboardShotSize {
  if (shot === 'wide') return SHOT_SIZE_EXTREME_WIDE;
  if (shot === 'close') return SHOT_SIZE_CLOSE;
  return SHOT_SIZE_MEDIUM;
}

export type StoryboardEntryMode = 'generate' | 'edit';

export function StoryboardEntryBody({
  onChooseEdit,
  onChooseGenerate,
}: {
  onChooseEdit: () => void;
  onChooseGenerate: () => void;
}) {
  const sb = useStoryboardCopy();
  return (
    <CanvasNodeStarter
      icon="storyboard"
      actions={<>
        <Button type="button" variant="ghost" onClick={event => { event.stopPropagation(); onChooseGenerate(); }}><Icon name="sparkle" size={18} /><span>{sb.type.fromText}</span></Button>
        <Button type="button" variant="ghost" onClick={event => { event.stopPropagation(); onChooseEdit(); }}><Icon name="edit" size={18} /><span>{sb.type.freeEdit}</span></Button>
      </>}
    />
  );
}

export function StoryboardGenerationComposer({
  generationType,
  generation,
  linkedAttachments,
  onGenerationTypeChange,
  onGenerate,
  onPromptChange,
  ownerId,
  prompt,
}: {
  generationType: StoryboardGenerationType;
  generation?: { status: 'running' | 'succeeded' | 'failed' | 'canceled'; error?: string };
  linkedAttachments: readonly CanvasLinkedAttachment[];
  onGenerationTypeChange: (value: StoryboardGenerationType) => void;
  onGenerate: () => void;
  onPromptChange: (value: string) => void;
  ownerId: string;
  prompt: string;
}) {
  const sb = useStoryboardCopy();
  const [expanded, setExpanded] = React.useState(false);
  const [typeMenuOpen, setTypeMenuOpen] = React.useState(false);
  const uiHost = useCanvasUiHost();
  const renderMenu = requireCanvasMenuRenderer(uiHost);
  const textSources = linkedAttachments.filter(attachment => !attachment.mimeType.startsWith('image/'));
  const running = generation?.status === 'running';
  const canGenerate = !running && Boolean(textSources.length || prompt.trim());

  return (
    <CanvasComposerShell
      ownerId={ownerId}
      expanded={expanded}
      className="basic-output-composer storyboard-output-composer"
      aria-label={sb.panel.scriptPanel}
      onSubmit={event => { event.preventDefault(); if (canGenerate) onGenerate(); }}
    >
      <CanvasComposerHeader
        attachmentsLabel={sb.panel.linkedText}
        addLabel={sb.panel.addReference}
        onAdd={openCanvasProjectAssets}
        expanded={expanded}
        onExpand={() => setExpanded(current => !current)}
      >
        {textSources.map(source => (
          <CanvasComposerAttachment
            key={`${source.sourceNodeId}:${source.path}`}
            name={source.name}
            mimeType={source.mimeType}
            className="is-linked"
          />
        ))}
      </CanvasComposerHeader>
      <div className="minimax-image-prompt-wrap basic-output-prompt-wrap">
        <CompositionSafeTextarea
          aria-label={sb.panel.extraInfo}
          value={prompt}
          maxLength={7500}
          disabled={running}
          onValueChange={onPromptChange}
          placeholder={sb.panel.extraPlaceholder}
        />
        <span className="minimax-image-prompt-count">{prompt.length} / 7500</span>
      </div>
      <div className="minimax-image-toolbar basic-output-toolbar">
        <div className="minimax-image-toolbar-left">
          {renderMenu({
            open: typeMenuOpen,
            onOpenChange: setTypeMenuOpen,
            contentClassName: 'basic-output-option-menu storyboard-type-menu',
            ariaLabel: sb.panel.pickType,
            label: sb.panel.type,
            side: 'top',
            align: 'start',
            selectedValue: generationType,
            onSelectedValueChange: value => onGenerationTypeChange(value as StoryboardGenerationType),
            trigger: (
              <Button
                type="button"
                variant="ghost"
                className="minimax-image-chip basic-output-option-chip storyboard-type-trigger nodrag nopan"
                aria-label={sb.panel.pickTypeAria(generationType === 'short-drama' ? sb.type.shortDrama : sb.type.general)}
                aria-expanded={typeMenuOpen}
              >
                <Icon name="tag" />
                <span>{generationType === 'short-drama' ? sb.type.shortDrama : sb.type.general}</span>
              </Button>
            ),
            items: [
              { id: 'general', value: 'general', content: <><Icon name="storyboard" /><span>{sb.type.general}</span></> },
              { id: 'short-drama', value: 'short-drama', content: <><Icon name="video" /><span>{sb.type.shortDrama}</span></> },
            ],
          })}
        </div>
        <div className="minimax-image-toolbar-right">
          <Button type="submit" variant="primary" size="icon" className="minimax-image-submit basic-output-submit" disabled={!canGenerate} aria-label={running ? sb.panel.generatingScript : sb.panel.generateScript} aria-busy={running}>
            {running ? <span className="basic-output-spinner" /> : '↑'}
          </Button>
        </div>
      </div>
    </CanvasComposerShell>
  );
}

function patchShot(plan: StoryboardPlan, shotId: string, patch: Partial<StoryboardShot>): StoryboardPlan {
  return { ...plan, shots: plan.shots.map(shot => shot.id === shotId ? { ...shot, ...patch } : shot) };
}

function StoryboardFieldPopover({
  children,
  displayValue,
  helper,
  index,
  label,
  placeholder,
  value,
  wide = false,
}: {
  children: React.ReactNode;
  displayValue?: string;
  helper: string;
  index: number;
  label: string;
  placeholder: string;
  value: string;
  wide?: boolean;
}) {
  const sb = useStoryboardCopy();
  const uiHost = useCanvasUiHost();
  const renderPopover = requireCanvasPopoverRenderer(uiHost);
  const renderHoverCard = requireCanvasHoverCardRenderer(uiHost);
  const portalContainer = useCanvasNodeOverlayPortalContainer();
  const [open, setOpen] = React.useState(false);
  const fullValue = value.trim();
  const visibleValue = fullValue ? (displayValue ?? fullValue) : placeholder;
  const shotNumber = String(index + 1).padStart(2, '0');
  const valueNode = fullValue
    ? renderHoverCard({
      trigger: <span className="storyboard-cell-value">{visibleValue}</span>,
      children: <p className="storyboard-value-hover-card__text">{fullValue}</p>,
      contentClassName: 'storyboard-value-hover-card',
      ariaLabel: sb.shotUi.fullContentAria(index + 1, label),
      side: 'top',
      align: 'start',
    })
    : <span className="storyboard-cell-value is-placeholder">{visibleValue}</span>;

  return renderPopover({
    open,
    onOpenChange: setOpen,
    contentClassName: `storyboard-field-popover${wide ? ' storyboard-field-popover--wide' : ''}`,
    ariaLabel: sb.shotUi.editAria(index + 1, label),
    role: 'dialog',
    side: 'bottom',
    align: 'start',
    sideOffset: 6,
    portalContainer,
    wrapDomainMenu: false,
    trigger: (
      <Button
        type="button"
        variant="ghost"
        className="storyboard-cell-trigger nodrag nopan"
        aria-label={sb.shotUi.editWithValueAria(index + 1, label, fullValue)}
        aria-expanded={open}
      >
        {valueNode}
        <Icon name="edit" size={12} className="storyboard-cell-edit-icon" />
      </Button>
    ),
    children: (
      <div
        className="storyboard-field-panel nodrag nopan nowheel"
        onPointerDown={event => event.stopPropagation()}
        onWheel={event => event.stopPropagation()}
      >
        <div className="storyboard-field-panel__header">
          <strong>{label}</strong>
          <span>{sb.labels.shot} {shotNumber}</span>
        </div>
        <div className="storyboard-field-panel__body">{children}</div>
        <div className="storyboard-field-panel__footer">
          <span>{helper}</span>
          <Button type="button" variant="primary" onClick={() => setOpen(false)}>{sb.labels.save}</Button>
        </div>
      </div>
    ),
  });
}

function StoryboardCameraMoveField({
  index,
  onChange,
  plan,
  shot,
}: {
  index: number;
  onChange: (plan: StoryboardPlan) => void;
  plan: StoryboardPlan;
  shot: StoryboardShot;
}) {
  const sb = useStoryboardCopy();
  const portalContainer = useCanvasNodeOverlayPortalContainer();
  const value = storyboardShotToVideoCameraMove(shot);
  const displaySummary = value ? videoCameraMoveSummary(value) : shot.cameraMovement;

  return (
    <VideoCameraMoveControl
      value={value}
      ariaLabel={sb.shotUi.cameraSettingsAria(index + 1)}
      footerHint={sb.shotUi.applyCameraHint}
      portalContainer={portalContainer}
      renderTrigger={({ open }) => (
        <Button
          type="button"
          variant="ghost"
          className="storyboard-cell-trigger nodrag nopan"
          aria-label={sb.shotUi.editCameraAria(index + 1, displaySummary)}
          aria-expanded={open}
        >
          <span className="storyboard-cell-value">{displaySummary}</span>
          <Icon name="edit" size={12} className="storyboard-cell-edit-icon" />
        </Button>
      )}
      onChange={cameraMove => onChange(patchShot(plan, shot.id, {
        cameraMove,
        cameraMovement: videoMoveToStoryboardMovement(cameraMove.move),
        shotSize: videoShotToStoryboardShotSize(cameraMove.shot),
      }))}
    />
  );
}

function StoryboardOptionField<T extends string>({
  ariaLabel,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  onChange: (value: T) => void;
  options: readonly T[];
  value: T;
}) {
  return (
    <div className="storyboard-field-options" role="group" aria-label={ariaLabel}>
      {options.map(option => (
        <CanvasSelectionItem
          key={option}
          selected={value === option}
          className="storyboard-field-option"
          onClick={() => onChange(option)}
        >
          {option}
        </CanvasSelectionItem>
      ))}
    </div>
  );
}

function StoryboardShotImage({
 shot: owner, frame = 'first', initialOpen = false, plan, index, library, onOpen }: { shot: StoryboardShot; frame?: 'first' | 'last'; initialOpen?: boolean; plan: StoryboardPlan; index: number; library?: StoryboardAssetLibrary; onOpen: () => void }) {
  const sb = useStoryboardCopy();
  const shot = { ...owner, imageNodeId: undefined, imageNodeHistoryIds: undefined, selectedImagePath: undefined, imageSources: undefined, imageAssetRevisions: undefined, ...storyboardFrame(owner, frame) };
  const [prompt, setPrompt] = React.useState<string>();
  const [count, setCount] = React.useState('1');
  const [ratioOverride, setImageRatio] = React.useState<StoryboardPlan['aspectRatio']>();
  const imageRatio = ratioOverride ?? storyboardFrame(owner, frame).imageRatio ?? plan.aspectRatio;
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);
  const [picker, setPicker] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const uploadRef = React.useRef<HTMLInputElement>(null);
  async function uploadFrame(files: readonly File[]) {
    if (!files.length) return false;
    if (files.length !== 1) { setError(sb.hints.pickOneImage); return false; }
    if (!files[0]!.type.startsWith('image/')) { setError(sb.hints.pickImageFile); return false; }
    setUploading(true); setError('');
    try {
      if (!library?.onUpload || !library.onUseShotImage) throw new Error(sb.hints.uploadUnsupported);
      const result = await library.onUpload(files[0]!);
      library.onUseShotImage(owner.id, result.path, frame);
      setPicker(false); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : sb.hints.uploadFailed); return false; }
    finally { setUploading(false); }
  }
  const text = prompt ?? (frame === 'last' ? sb.hints.lastFramePrompt : '') + buildStoryboardShotPrompt({ ...plan, aspectRatio: imageRatio }, shot);
  const images = storyboardShotImages(shot, library?.images || []);
  const ready = images.filter(image => image.path && image.status !== 'generating' && image.status !== 'failed');
  const image = selectedStoryboardShotImage(shot, library?.images || []);
  const pending = images.some(image => image.status === 'generating');
  const failed = !image && images.some(image => image.status === 'failed');
  const used = image?.sourceInstanceId ? shot.imageSources?.[image.sourceInstanceId]?.references : undefined;
  const currentRefs = [...(shot.characters || []), ...(shot.scene ? [shot.scene] : [])];
  const changed = library && shot.imageNodeId && (used ? used.length !== currentRefs.length || currentRefs.some(ref => { const current = resolveStoryboardAsset(ref, library.assets); const saved = used.find(item => item.assetId === ref.assetId); return !saved || saved.revision !== current?.asset.revision || saved.path !== current?.variant?.referencePath; }) : currentRefs.some(ref => library.assets.find(a => a.id === ref.assetId)?.revision !== shot.imageAssetRevisions?.[ref.assetId]));
  const trigger = <Button variant="ghost" className="storyboard-shot-image" aria-label={sb.shotUi.genFrameAria(index + 1, frame === 'last')} title={sb.shotUi.frameSettings} onClick={library?.onGenerateShot ? undefined : onOpen}>
    {image?.path ? <img src={projectFileUrl(image.path)} alt={sb.shotUi.shotFrameAria(index + 1)} /> : <><Icon name="image" size={18} /><span>{pending ? sb.labels.generating : failed ? sb.labels.retry : sb.labels.generateImage}</span></>}
    {ready.length > 1 && <small>{ready.length} {sb.labels.versionShort}</small>}
    {changed && <i title={sb.shotUi.settingsUpdatedKept} aria-label={sb.shotUi.settingsUpdated} />}
  </Button>;
  if (!library?.onGenerateShot) return trigger;
  return <AssetPopover initialOpen={initialOpen} label={sb.shotUi.frameTitle(String(index + 1).padStart(2, '0'), frame === 'last' ? 'last' : owner.tailFrame ? 'first' : 'storyboard')} trigger={trigger}>
    <form className="storyboard-shot-settings nodrag nopan" onSubmit={async event => {
      event.preventDefault();
      if (submitting || pending || !text.trim()) return;
      setSubmitting(true); setError(''); setSubmitted(false);
      try { await library.onGenerateShot!(shot.id, text, Number(count), frame, imageRatio); setSubmitted(true); }
      catch (cause) { setError(cause instanceof Error ? cause.message : sb.hints.genFailedRetry); }
      finally { setSubmitting(false); }
    }}>
      {library.onUseShotImage && <div className="storyboard-frame-import-actions">
        <Button type="button" variant="ghost" disabled={uploading || !library.onUpload} onClick={() => uploadRef.current?.click()}><Icon name="image" size={14} />{uploading ? sb.hints.uploading : sb.actions.uploadImage}</Button>
        <Button type="button" variant="ghost" disabled={uploading} onClick={() => { setError(''); setPicker(true); }}><Icon name="folder" size={14} />{sb.actions.pickAsset}</Button>
        <input ref={uploadRef} type="file" accept="image/*" hidden aria-label={sb.actions.uploadCurrentFrame} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void uploadFrame(files); }} />
      </div>}
      <CompositionSafeTextarea aria-label={sb.hints.storyboardPrompt} value={text} onValueChange={setPrompt} />
      <div className="storyboard-shot-settings-refs">{currentRefs.length ? currentRefs.map(ref => {
        const resolved = resolveStoryboardAsset(ref, library.assets);
        if (!resolved) return null;
        return <span key={ref.assetId}>{resolved.variant?.referencePath && <img src={projectFileUrl(resolved.variant.referencePath)} alt="" />}{resolved.asset.name}</span>;
      }) : <span>{sb.hints.noRefFromPrompt}</span>}</div>
      <div className="storyboard-asset-scene-view"><span>{sb.hints.genAspect}</span><CanvasSegmentedControl label={sb.hints.storyboardAspect} value={imageRatio} options={(['16:9', '9:16', '1:1', '4:3', '3:4'] as const).map(id => ({ id, label: id }))} onChange={ratio => { setImageRatio(ratio); setPrompt(current => current?.replace(/画幅[：:]\s*(?:16:9|9:16|1:1|4:3|3:4)/g, sb.shotUi.aspectAria(ratio))); }} /></div>
      <div className="storyboard-shot-settings-actions"><Select aria-label={sb.hints.genCount} value={count} onChange={event => setCount(event.target.value)}>{[1, 2, 4].map(n => <option key={n} value={n}>{n} {sb.hints.sheets}</option>)}</Select>
        {image && <Button type="button" variant="ghost" onClick={() => library.onFocusShotImage?.(shot.id, frame)}>{sb.actions.editCurrent}</Button>}
        <Button type="submit" variant="primary" aria-label={submitting || pending ? sb.labels.generating : image ? sb.labels.generateNewVersion : sb.labels.generateStoryboard} aria-busy={submitting || pending} disabled={submitting || pending || !text.trim()}>{submitting || pending ? <span className="basic-output-spinner" aria-hidden="true" /> : <><Icon name="image" size={14} />{image ? sb.labels.generateNewVersion : sb.labels.generateStoryboard}</>}</Button>
      </div>
      {error && <CanvasErrorNotice error={error} />}
      {submitted && !error && <p role="status">{sb.hints.submittedSeeCanvas}</p>}
    </form>
    {picker && <ImageReferenceResourcePicker open singleSelection resources={(library.images || []).filter(i => i.path && i.status !== 'generating' && i.status !== 'failed').map(i => ({ id: i.id, name: i.name || sb.labels.image, path: i.path, src: i.src, kind: 'image' }))} onClose={() => setPicker(false)} onUseCanvas={ids => {
      if (ids.length !== 1) { setError(sb.hints.pickOneImage); return; }
      const selected = library.images.find(i => i.id === ids[0]);
      if (!selected?.path) { setError(sb.hints.imageUnavailable); return; }
      try { library.onUseShotImage?.(owner.id, selected.path, frame); setError(''); setPicker(false); }
      catch (cause) { setPicker(false); setError(cause instanceof Error ? cause.message : sb.hints.selectFailed); }
    }} onUseLibrary={files => uploadFrame(files)} onUpload={files => uploadFrame(Array.from(files || []))} />}
  </AssetPopover>;
}

function StoryboardShotActionsMenu({
  index,
  onChange,
  onCreateImageNode,
  plan,
  shot,
}: {
  index: number;
  onChange: (plan: StoryboardPlan) => void;
  onCreateImageNode: (shot: StoryboardShot) => void;
  plan: StoryboardPlan;
  shot: StoryboardShot;
}) {
  const sb = useStoryboardCopy();
  const uiHost = useCanvasUiHost();
  const renderMenu = requireCanvasMenuRenderer(uiHost);
  const [open, setOpen] = React.useState(false);

  return renderMenu({
    open,
    onOpenChange: setOpen,
    contentClassName: 'storyboard-shot-menu',
    ariaLabel: sb.shotUi.shotActionsAria(index + 1),
    label: sb.shotUi.shotLabel(index + 1),
    side: 'bottom',
    align: 'end',
    trigger: (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="storyboard-shot-more nodrag nopan"
        aria-label={sb.shotUi.moreActionsAria(index + 1)}
        aria-expanded={open}
        title={sb.labels.moreActions}
        onPointerDown={event => event.stopPropagation()}
      >
        <Icon name="more" />
      </Button>
    ),
    items: [
      {
        id: 'generate',
        content: <><Icon name="image" /><span>{shot.imageNodeId ? sb.actions.newVersion : sb.actions.generateShotImage}</span></>,
        onSelect: () => onCreateImageNode({ ...shot, imageNodeId: undefined }),
      },
      {
        id: 'duplicate',
        content: <><Icon name="copy" /><span>{sb.actions.duplicateShot}</span></>,
        onSelect: () => onChange(duplicateStoryboardShot(plan, shot.id)),
      },
      { id: 'separator', kind: 'separator' },
      {
        id: 'delete',
        content: <><Icon name="trash" /><span>{sb.actions.deleteShot}</span></>,
        className: 'storyboard-shot-menu-destructive',
        disabled: plan.shots.length <= 1,
        onSelect: () => onChange(removeStoryboardShot(plan, shot.id)),
      },
    ],
  });
}

export function StoryboardCanvasBody({
 plan, onChange, onCreateImageNode, library, onHeightChange }: {
  library?: StoryboardAssetLibrary;
  plan: StoryboardPlan;
  onChange: (plan: StoryboardPlan) => void;
  onCreateImageNode: (shot: StoryboardShot) => void;
  onHeightChange?: (height: number) => void;
}) {
  const sb = useStoryboardCopy();
  const [draggingShotId, setDraggingShotId] = React.useState<string | null>(null);
  const [newTailId, setNewTailId] = React.useState<string>();
  const [dropTarget, setDropTarget] = React.useState<{ shotId: string; placement: 'before' | 'after' } | null>(null);
  const duration = storyboardDuration(plan);
  const relatedShots = relatedStoryboardShots(plan.shots, library?.assets || [], library?.relation);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const tableRef = React.useRef<HTMLElement>(null);
  const [tableHeight, setTableHeight] = React.useState<number>();
  React.useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table || typeof ResizeObserver === 'undefined') return;
    const rows = [...table.querySelectorAll<HTMLElement>('.storyboard-shot-item')];
    const header = table.querySelector<HTMLElement>('.storyboard-shot-grid-head');
    const measure = () => setTableHeight(storyboardTableViewportHeight(rows.map(row => row.offsetHeight), header?.offsetHeight || 0));
    measure();
    const observer = new ResizeObserver(measure);
    rows.slice(0, 4).forEach(row => observer.observe(row));
    if (header) observer.observe(header);
    return () => observer.disconnect();
  }, [plan.shots]);
  React.useEffect(() => {
    const body = bodyRef.current;
    if (!body || !onHeightChange || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (body.offsetHeight > 0) onHeightChange(Math.ceil(body.offsetHeight) + 2);
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, [onHeightChange]);

  return (
    <div ref={bodyRef} className="storyboard-node-body" data-storyboard-scope={library?.storyboardId} data-relation-active={Boolean(library?.relation)}>
      <header className="storyboard-card-toolbar node-drag-surface">
        <div className="storyboard-card-stats">
          <strong>{sb.labels.storyboardScript}</strong>
          <span>{plan.shots.length} {sb.labels.shotAbbrev} {duration} {sb.labels.seconds}</span>
        </div>
        <div className="storyboard-card-actions nodrag nopan">
          <Select aria-label={sb.labels.videoAspect} value={plan.aspectRatio} onChange={event => onChange({ ...plan, aspectRatio: event.target.value as StoryboardPlan['aspectRatio'] })}>
            {['16:9', '9:16', '1:1', '4:3', '3:4'].map(ratio => <option key={ratio}>{ratio}</option>)}
          </Select>
          <Button variant="primary" onClick={() => onChange({ ...plan, shots: [...plan.shots, createStoryboardShot()] })}><Icon name="plus" />{sb.labels.addShot}</Button>
        </div>
      </header>

      <section ref={tableRef} className={`storyboard-shot-section nodrag nopan${plan.shots.length > 4 ? ' nowheel is-scrollable' : ''}`} style={{ maxHeight: plan.shots.length > 4 ? tableHeight : undefined }} onWheel={event => { if (plan.shots.length > 4) event.stopPropagation(); }} aria-label={sb.labels.shotList} role="table">
        <div className="storyboard-shot-grid storyboard-shot-grid-head" role="row">
          {[sb.labels.shotNumber, sb.labels.storyboardImage, sb.labels.duration, sb.labels.description, sb.labels.shotSize, sb.labels.lighting, sb.labels.dialogueNarration, sb.labels.sfx, sb.labels.cameraMove, sb.labels.finalPrompt, sb.labels.actions].map(label => (
            <span key={label} role="columnheader">{label}</span>
          ))}
        </div>
        <div className="storyboard-shot-list nowheel" role="rowgroup" onWheel={event => event.stopPropagation()}>
          {plan.shots.map((shot, index) => (
            <div
              className={`storyboard-shot-item storyboard-shot-editor storyboard-shot-grid${draggingShotId === shot.id ? ' is-dragging' : ''}${dropTarget?.shotId === shot.id ? ` is-drop-${dropTarget.placement}` : ''}`}
              key={shot.id}
              data-shot-id={shot.id}
              onClick={event => {
                if ((event.target as Element).closest('button,input,textarea,select,[contenteditable="true"],[role="button"]')) return;
                library?.onPinRelation?.({ kind: 'shot', id: shot.id });
              }}
              data-asset-related={relatedShots.some(s => s.id === shot.id) || Boolean(library?.focusedAssetId && (shot.characters?.some(r => r.assetId === library.focusedAssetId) || shot.scene?.assetId === library.focusedAssetId))}
              onPointerEnter={event => { if (!draggingShotId && event.pointerType !== 'touch') library?.onHoverRelation?.({ kind: 'shot', id: shot.id }); }}
              onPointerLeave={() => library?.onHoverRelation?.()}
              onFocusCapture={() => library?.onHoverRelation?.({ kind: 'shot', id: shot.id })}
              onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) library?.onHoverRelation?.(); }}
              role="row"
              onDragOver={event => {
                if (!draggingShotId || draggingShotId === shot.id) return;
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                setDropTarget({ shotId: shot.id, placement: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after' });
              }}
              onDrop={event => {
                event.preventDefault();
                const draggedId = event.dataTransfer.getData('text/plain') || draggingShotId;
                if (draggedId && draggedId !== shot.id) {
                  const bounds = event.currentTarget.getBoundingClientRect();
                  const placement = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after';
                  onChange(reorderStoryboardShot(plan, draggedId, shot.id, placement));
                }
                setDraggingShotId(null);
                setDropTarget(null);
              }}
            >
              <span className="storyboard-shot-cell storyboard-shot-number" role="cell">
                <Button
                  variant="ghost"
                  draggable
                  className="storyboard-shot-drag-handle nodrag nopan"
                  aria-label={sb.shotUi.dragSortAria(index + 1)}
                  title={sb.hints.dragToPinSort}
                  aria-pressed={library?.pinnedRelation?.kind === 'shot' && library.pinnedRelation.id === shot.id}
                  onClick={event => { event.preventDefault(); event.stopPropagation(); library?.onPinRelation?.({ kind: 'shot', id: shot.id }); }}
                  onDragStart={event => {
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', shot.id);
                    setDraggingShotId(shot.id);
                    library?.onHoverRelation?.();
                  }}
                  onDragEnd={() => { setDraggingShotId(null); setDropTarget(null); }}
                >
                  <span>{String(index + 1).padStart(2, '0')}</span>
                </Button>
              </span>
              <span className="storyboard-shot-cell storyboard-shot-image-cell" role="cell">
                <div className="storyboard-frame-pair">
                <div><small>{shot.tailFrame ? sb.labels.firstFrame : sb.labels.storyboardImage}</small>
                <StoryboardShotImage shot={shot} plan={plan} index={index} library={library} onOpen={() => selectedStoryboardShotImage(shot, library?.images || []) && library?.onFocusShotImage ? library.onFocusShotImage(shot.id) : onCreateImageNode(shot)} />
                </div>
                {shot.tailFrame ? <div><small>{sb.labels.lastFrame}<Button variant="ghost" size="icon" aria-label={sb.shotUi.removeLastFrameAria(index + 1)} onClick={() => onChange(patchShot(plan, shot.id, { tailFrame: undefined }))}><Icon name="close" size={10} /></Button></small><StoryboardShotImage shot={shot} frame="last" initialOpen={newTailId === shot.id} plan={plan} index={index} library={library} onOpen={() => library?.onFocusShotImage?.(shot.id, 'last')} /></div>
                  : library?.onGenerateShot && <Button variant="ghost" className="storyboard-add-tail nodrag nopan" aria-label={sb.shotUi.addLastFrameAria(index + 1)} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); setNewTailId(shot.id); onChange(patchShot(plan, shot.id, { tailFrame: {} })); }}><Icon name="plus" size={12} /><span>{sb.labels.addLastFrame}</span></Button>}
                </div>
                {library ? <StoryboardShotAssets shot={shot} library={library} onChange={next => onChange(patchShot(plan, shot.id, { ...next, imageAssetRevisions: shot.imageNodeId ? {} : undefined }))} /> : null}
                {library?.onCreateShotVideo && <Button variant="ghost" className="storyboard-shot-video" disabled={!selectedStoryboardShotImage(shot, library.images) || Boolean(shot.tailFrame && !selectedStoryboardShotImage(shot.tailFrame, library.images))} onClick={() => library.onCreateShotVideo?.(shot.id)}>{shot.tailFrame ? sb.labels.firstLastComposite : sb.labels.imageToVideo}</Button>}
              </span>
              <span className="storyboard-shot-cell storyboard-shot-duration" role="cell">
                <StoryboardFieldPopover index={index} label={sb.labels.duration} value={sb.shotUi.durationValue(shot.durationSec)} placeholder={sb.labels.setDuration} helper={sb.hints.durationRange}>
                  <div className="storyboard-duration-input-wrap">
                    <Input aria-label={sb.shotUi.durationAria(index + 1)} type="number" min="4" max="30" step="1" value={shot.durationSec} onChange={event => onChange(patchShot(plan, shot.id, { durationSec: Math.min(30, Math.max(4, Number(event.target.value) || 4)) }))} />
                    <span>{sb.labels.seconds}</span>
                  </div>
                </StoryboardFieldPopover>
              </span>
              <span className="storyboard-shot-cell storyboard-shot-cell--multiline storyboard-shot-description" role="cell">
                <StoryboardFieldPopover index={index} label={sb.labels.description} value={shot.description} placeholder={sb.hints.addDescription} helper={sb.hints.descriptionHint} wide>
                  <CompositionSafeTextarea aria-label={sb.shotUi.descriptionAria(index + 1)} value={shot.description} rows={5} placeholder={sb.hints.descriptionPlaceholder} onValueChange={description => onChange(patchShot(plan, shot.id, { description }))} />
                </StoryboardFieldPopover>
              </span>
              <span className="storyboard-shot-cell" role="cell">
                <StoryboardFieldPopover index={index} label={sb.labels.shotSize} value={shot.shotSize} placeholder={sb.hints.pickShotSize} helper={sb.hints.shotSizeHint}>
                  <StoryboardOptionField ariaLabel={sb.shotUi.shotSizeOptionsAria(index + 1)} value={shot.shotSize} options={SHOT_SIZES} onChange={shotSize => onChange(patchShot(plan, shot.id, { shotSize }))} />
                </StoryboardFieldPopover>
              </span>
              <span className="storyboard-shot-cell" role="cell">
                <StoryboardFieldPopover index={index} label={sb.labels.lighting} value={shot.lighting || ''} placeholder={sb.hints.addLighting} helper={sb.hints.lightingHint}>
                  <CompositionSafeInput aria-label={sb.shotUi.lightingAria(index + 1)} value={shot.lighting || ''} placeholder={sb.hints.lightingPlaceholder} onValueChange={lighting => onChange(patchShot(plan, shot.id, { lighting }))} />
                </StoryboardFieldPopover>
              </span>
              <span className="storyboard-shot-cell storyboard-shot-cell--multiline" role="cell">
                <StoryboardFieldPopover index={index} label={sb.hints.dialogueLabel} value={shot.dialogue} placeholder={sb.hints.addDialogue} helper={sb.hints.dialogueHint} wide>
                  <CompositionSafeTextarea aria-label={sb.shotUi.dialogueAria(index + 1)} value={shot.dialogue} rows={4} placeholder={sb.hints.dialoguePlaceholder} onValueChange={dialogue => onChange(patchShot(plan, shot.id, { dialogue }))} />
                </StoryboardFieldPopover>
              </span>
              <span className="storyboard-shot-cell" role="cell">
                <StoryboardFieldPopover index={index} label={sb.labels.sfx} value={shot.sound || ''} placeholder={sb.hints.addSfx} helper={sb.hints.sfxHint}>
                  <CompositionSafeInput aria-label={sb.shotUi.sfxAria(index + 1)} value={shot.sound || ''} placeholder={sb.hints.sfxPlaceholder} onValueChange={sound => onChange(patchShot(plan, shot.id, { sound }))} />
                </StoryboardFieldPopover>
              </span>
              <span className="storyboard-shot-cell" role="cell">
                <StoryboardCameraMoveField
                  index={index}
                  plan={plan}
                  shot={shot}
                  onChange={onChange}
                />
              </span>
              <span className="storyboard-shot-cell storyboard-shot-cell--multiline" role="cell">
                <StoryboardFieldPopover index={index} label={sb.labels.finalPrompt} value={shot.finalPrompt || ''} placeholder={sb.labels.pendingPrompt} helper={sb.hints.finalPromptHint} wide>
                  <CompositionSafeTextarea aria-label={sb.shotUi.finalPromptAria(index + 1)} value={shot.finalPrompt || ''} rows={5} placeholder={sb.hints.finalPromptAuto} onValueChange={finalPrompt => onChange(patchShot(plan, shot.id, { finalPrompt }))} />
                </StoryboardFieldPopover>
              </span>
              <span className="storyboard-shot-cell storyboard-shot-actions" role="cell">
                <StoryboardShotActionsMenu
                  index={index}
                  plan={plan}
                  shot={shot}
                  onChange={onChange}
                  onCreateImageNode={onCreateImageNode}
                />
              </span>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}
