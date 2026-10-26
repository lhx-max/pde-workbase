'use client';

import { CanvasErrorNotice } from './CanvasErrorNotice';
import { cardRendererFor } from './card-registry';
import { bn } from '../locales/basic-node';
import { TextGenerationOptionControls } from './TextGenerationOptionControls';
import { type ArtifactTextOptions, type ArtifactPageOptions, type ArtifactPresentationOptions } from '@bezier/contracts';
import { PageGenerationOptionControls } from './PageGenerationOptionControls';import { CanvasSaveAssetButton } from './CanvasSaveAssetButton';
import { storyboardShotReferences, storyboardReferenceContext, storyboardReferenceImage, storyboardReferenceImageLabels } from './storyboard-assets';
import { selectedStoryboardShotImage } from './storyboard-shot-images';

import React from 'react';
import { createPortal } from 'react-dom';
import { CanvasTextToolbar } from './CanvasTextToolbar';
import textToolbarStyles from './CanvasTextToolbar.module.css';
import pageStyles from './PageGenerationStatus.module.css';
import type { CanvasResultSnapshot } from '@bezier/contracts';
import { CanvasResultHistory } from './CanvasResultHistory';
import { CanvasNodeRenderBoundary, useCanvasRenderDetail } from './CanvasRenderPolicy';
import { CANVAS_INPUT_SELECTOR, releaseCanvasInputFocus } from './canvas-interaction';
import { Button } from '@bezier/components';
import { useCanvasUiHost } from '../platform/ui-host';
import { useCanvasKindAvailability } from '../platform/kind-availability';
import type { ArtifactDescriptor } from '@bezier/contracts';
import { canvasArtifactProjection } from '@bezier/contracts';
import { Icon, type IconName } from '../ui/Icon';
import {
  Handle,
  NodeResizer,
  Position,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { ResultCard } from './ResultCard';
import { ChatAddIcon, type ImageConnectedNodeKind, type ImageConnectedNodeOrigin } from './ImageAssetNode';
import { CanvasNodeSourceHandle } from './CanvasNodeSourceHandle';
import { CanvasNodeActions } from './CanvasNodeActions';
import { submitAgentTask } from '../platform/agent-bridge';
import { useCanvasInteractionStatus, useCanvasFlush } from '../platform/canvas-compat';
import { projectFileUrl, getCanvasHostContext } from '../platform/api-base';
import { stageCanvasObject, canvasObjectReference } from '../platform/object-bridge';
import {
  openArtifact,
  openTextDocument,
} from '../platform/artifact-bridge';
import type { CanvasLinkedAttachment } from './canvas-linked-attachments';
import type { CanvasReferenceResource } from './ImageReferenceResourcePicker';
import { CompositionSafeInput, CompositionSafeTextarea } from './CompositionSafeField';
import { createPresentationGenerationTask, normalizeCanvasPresentationGenerationIntent } from './presentation-generation-launch';
import {
  createWebpageGenerationTask,
  normalizeCanvasWebpageGenerationIntent,
} from './webpage-generation-launch';
import {
  StoryboardCanvasBody,
  StoryboardEntryBody,
  StoryboardGenerationComposer,
  type StoryboardEntryMode,
} from './StoryboardCanvasNode';
import { VideoCanvasNode } from './VideoCanvasNode';
import { CanvasOutputFrame, CanvasOutputNode, CanvasOutputStatus } from './CanvasOutputNode';
import { CanvasNodeStarter } from './CanvasNodeStarter';
import { excludedCanvasDownstreamKinds } from './canvas-node-catalog';
import { resolveVideoFrameSize } from './video-frame-size';
import { HTML_PAGE_CARD_SIZE } from './visual-node-size';
import { canvasTextDocumentPath } from './model/canvas-text-files';
import type { VideoCameraMove } from './video-camera-move';
import {
  CanvasComposerAttachment,
  CanvasComposerHeader,
  CanvasComposerShell,
} from './CanvasComposerChrome';
import {
  buildStoryboardGenerationPrompt,
  buildStoryboardShotPrompt,
  createDefaultStoryboardPlan,
  type StoryboardGenerationType,
  type StoryboardPlan,
} from './storyboard-card';

export type CanvasBasicNodeKind = 'text' | 'sketch' | 'page' | 'image' | 'artifact' | 'storyboard' | 'video' | (string & {});

export const TEXT_CARD_DEFAULT_WIDTH = 420;
export const TEXT_CARD_DEFAULT_HEIGHT = 520;
export const STORYBOARD_CARD_DEFAULT_WIDTH = TEXT_CARD_DEFAULT_WIDTH;
export const STORYBOARD_CARD_DEFAULT_HEIGHT = 520;
// Eleven columns need 1090px; reserve room for readable flexible columns and the scrollbar.
export const STORYBOARD_EDITOR_DEFAULT_WIDTH = 1320;
export const STORYBOARD_EDITOR_MIN_WIDTH = 1240;
export const STORYBOARD_EDITOR_MIN_HEIGHT = 240;
export const STORYBOARD_EDITOR_MAX_HEIGHT = 620;
const STORYBOARD_EDITOR_CHROME_HEIGHT = 164;
const STORYBOARD_EDITOR_ROW_HEIGHT = 76;

export function storyboardEditorHeight(shotCount: number): number {
  const contentHeight = STORYBOARD_EDITOR_CHROME_HEIGHT
    + Math.max(1, Math.floor(shotCount)) * STORYBOARD_EDITOR_ROW_HEIGHT;
  return Math.max(STORYBOARD_EDITOR_MIN_HEIGHT, contentHeight);
}

export const STORYBOARD_SOURCE_EXAMPLE = bn().sampleScript;

export type CanvasVideoResult = {
  id: string;
  path: string;
  createdAt: number;
  model: string;
  aspect: string;
  length: number;
  resolution: string;
};

export type CanvasBasicNode = {
  id: string;
  kind: CanvasBasicNodeKind;
  x: number;
  y: number;
  width?: number;
  height?: number;
  title: string;
  text?: string;
  /** Once entered, a text card remains in its inline editor across selection changes and reloads. */
  textEntryMode?: 'edit';
  textInstruction?: string;
  textOptions?: ArtifactTextOptions;
  videoModel?: string;
  videoMode?: 't2v' | 'i2v' | 'firstlast';
  /** Explicit storyboard frame slots must not be replaced by generic upstream references. */
  storyboardVideoSource?: { storyboardId: string; shotId: string };
  storyboardVideoFrames?: CanvasLinkedAttachment[];
  /** Provider-compatible public URL used as the first frame for i2v. */
  videoFirstFrameUrl?: string;
  /** Provider-compatible public URL used as the last frame for first/last-frame video. */
  videoLastFrameUrl?: string;
  videoCameraMove?: VideoCameraMove;
  videoAspect?: string;
  videoLength?: number;
  videoSubmitRequestId?: string;
  videoResolution?: string;
  videoTask?: {
    backendOwned?: boolean;
    id: string;
    status: 'running' | 'done' | 'failed';
    path?: string;
    error?: string;
    progress?: string[];
    model?: string;
    aspect?: string;
    length?: number;
    resolution?: string;
    createdAt?: number;
  };
  videoResults?: CanvasVideoResult[];
  activeVideoResultId?: string;
  /** Desired format while this is still a creation brief. */
  artifactFormat?: 'html' | 'presentation';
  presentationOptions?: ArtifactPresentationOptions & { length: NonNullable<ArtifactPresentationOptions['length']>; template: string };
  webpageOptions?: ArtifactPageOptions;
  /** Existing project file represented by this canvas node. */
  projectFilePath?: string;
  /** Only a newly inserted blank card may create its backing file on first open. */
  sketchPending?: boolean;
  resultHistory?: CanvasResultSnapshot[];
  sourceMime?: string;
  /** A durable reference to a project or live artifact; its editor remains in the host workspace. */
  artifact?: ArtifactDescriptor;
  /** Project-backed inputs derived from incoming canvas edges. */
  linkedAttachments?: CanvasLinkedAttachment[];
  /** Team card-pack payload: opaque to the platform, owned by the pack. */
  data?: Record<string, unknown>;
  dataVersion?: number;
  /** Canvas-native shot order and generation intent. Media remains in image/video nodes. */
  storyboard?: StoryboardPlan;
  /** Empty storyboard cards choose generation or direct editing before materializing shots. */
  storyboardEntryMode?: StoryboardEntryMode;
  /** User-authored context layered on top of connected text when generating shots. */
  storyboardPrompt?: string;
  storyboardRequirements?: import('@bezier/contracts').ReportStoryboardRequirements;
  /** First delivery only; manual movement is never continuously constrained. */
  storyboardInitialLayoutPending?: boolean;
  /** Planner profile selected in the storyboard generation composer. */
  storyboardGenerationType?: StoryboardGenerationType;
  source?: {
    workflowRunId: string;
    stepRunId: string;
    nodeId: string;
    agentStepRunId?: string;
    resultId?: string;
    itemIds?: string[];
  };
  generation?: {
    requestId: string;
    baseStoryboard?: string;
    baseText?: string;
    candidateText?: string;
    runId?: string;
    appliedRequestId?: string;
    status: 'running' | 'succeeded' | 'failed' | 'canceled';
    previewPath?: string;
    totalSlides?: number;
    error?: string;
  };
};

export type BasicCanvasNodeData = {
  storyboardLibrary?: import('./storyboard-assets').StoryboardAssetLibrary;
  onSelect?: (id: string) => void;
  onFocus?: (id: string) => void;
  node: CanvasBasicNode;
  generationProgress?: import('../platform/agent-bridge').CanvasArtifactGenerationResult;
  onPatch: (id: string, patch: Partial<CanvasBasicNode>) => void;
  onRemoveReference?: (targetId: string, sourceId: string) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onPickImage: (id: string, file: File) => void;
  canvasMediaResources?: CanvasReferenceResource[];
  onAddConnectedNode: (sourceId: string, kind: ImageConnectedNodeKind, origin: ImageConnectedNodeOrigin) => string | void;
  onAddUpstreamTextNode?: (targetId: string, origin: ImageConnectedNodeOrigin) => void;
};

function NodeGlyph({ kind }: { kind: CanvasBasicNodeKind }) {
  const names: Partial<Record<CanvasBasicNodeKind, IconName>> = {
    text: 'text',
    sketch: 'edit',
    page: 'code',
    image: 'image',
    artifact: 'layers',
    storyboard: 'storyboard',
    video: 'video',
    clip: 'storyboard',
  };
  return <Icon name={names[kind] ?? 'layers'} size={18} />;
}

export function CanvasNodeLabel({ kind, title, actions }: {
  kind: CanvasBasicNodeKind;
  title: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="basic-canvas-label node-drag-surface">
      <span className="basic-node-kind-icon"><NodeGlyph kind={kind} /></span>
      {title}
      {actions}
    </div>
  );
}

export function TextDocumentIcon({ size = 20 }: { size?: number }) {
  return <Icon name="file" size={size} />;
}

async function loadLinkedAttachmentFile(attachment: CanvasLinkedAttachment): Promise<File> {
  if (attachment.validationError) throw new Error(attachment.validationError);
  if (attachment.content !== undefined) {
    return new File([attachment.content], attachment.name, {
      type: attachment.mimeType || 'text/markdown',
    });
  }
  const response = await fetch(projectFileUrl(attachment.path));
  if (!response.ok) throw new Error(bn().prompts.linkedAttachmentHttp(attachment.name, response.status));
  const blob = await response.blob();
  return new File([blob], attachment.name, {
    type: attachment.mimeType || blob.type || 'application/octet-stream',
  });
}

function TextArtifactNode({
  data,
  selected,
}: Pick<NodeProps<Node<BasicCanvasNodeData>>, 'data' | 'selected'>) {
  const item = data.node;
  const textUiHost = useCanvasUiHost();
  const selectText = () => data.onSelect?.(item.id);
  const [editingInline, setEditingInline] = React.useState(item.textEntryMode === 'edit');
  const [toolbarContainer, setToolbarContainer] = React.useState<HTMLElement | null>(null);
  const [composerExpanded, setComposerExpanded] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const submissionRef = React.useRef(false);
  const running = submitting || item.generation?.status === 'running';
  const linkedAttachments = item.linkedAttachments || [];
  const prompt = item.textInstruction || '';
  const hasInstruction = Boolean(prompt.trim() || item.textOptions?.templatePrompt?.trim());

  async function generateText() {
    if (submissionRef.current || running || !hasInstruction) return;
    submissionRef.current = true;
    setSubmitting(true);
    const requestId = globalThis.crypto.randomUUID();
    data.onPatch(item.id, { generation: { requestId, status: 'running', baseText: item.text || '' } });
    try {
      textUiHost?.getExecutionSnapshot?.();
      const files = await Promise.all(linkedAttachments.map(loadLinkedAttachmentFile));
      await submitAgentTask(bn().prompts.textGeneration(prompt.trim(), item.text || '', item.textOptions || {}), {
        kind: 'instruction-card', title: bn().actions.generateText, visiblePrompt: prompt.trim() || item.textOptions?.templateTitle || bn().actions.generateText,
        canvasTextGeneration: { requestId, nodeId: item.id },
        taskContext: {
          targetLabel: item.title || bn().labels.text,
          baseVersionKind: 'target-snapshot',
          baseVersionSource: JSON.stringify({ text: item.text || '', prompt, options: item.textOptions || {}, attachments: linkedAttachments.map(({name, path}) => ({name, path})) }),
        },
      }, files);
    } catch (error) {
      data.onPatch(item.id, { generation: { requestId, status: 'failed', error: error instanceof Error ? error.message : bn().errors.startFailed } });
    } finally {
      submissionRef.current = false;
      setSubmitting(false);
    }
  }
  const inlineEditorRef = React.useRef<HTMLDivElement>(null);
  const focusEditorRequestedRef = React.useRef(false);
  const beginInlineEditing = (focusEditor = true, selectNode = true) => {
    if (running) return;
    if (selectNode) selectText();
    focusEditorRequestedRef.current = focusEditor;
    setEditingInline(true);
    if (item.textEntryMode !== 'edit') data.onPatch(item.id, { textEntryMode: 'edit' });
  };
  React.useEffect(() => {
    if (!focusEditorRequestedRef.current || !selected) return;
    const input = inlineEditorRef.current?.querySelector<HTMLElement>(CANVAS_INPUT_SELECTOR);
    if (!input) return;
    focusEditorRequestedRef.current = false;
    input.focus({ preventScroll: true });
  }, [editingInline, selected]);

  const [openingDocument, setOpeningDocument] = React.useState(false);

  const documentPath = canvasTextDocumentPath(item);

  const artifact = React.useMemo<ArtifactDescriptor>(() => ({
    id: `canvas-text-${item.id}`,
    projectId: '',
    title: item.title || bn().labels.text,
    renderer: 'document',
    resource: { kind: 'project-file', path: documentPath, mimeType: 'text/markdown' },
    preview: item.text?.trim() ? { markdown: item.text } : undefined,
    capabilities: ['edit'],
    status: 'ready',
    updatedAt: new Date(0).toISOString(),
  }), [documentPath, item.id, item.text, item.title]);

  async function openEditor() {
    if (openingDocument) return;
    setOpeningDocument(true);
    try {
      const result = await openTextDocument({
        preferContent: true,
        nodeId: item.id,
        path: documentPath,
        title: item.title || bn().labels.text,
        content: item.text || '',
      });
      if (result.content !== (item.text || '')) {
        data.onPatch(item.id, { text: result.content });
      }
    } catch {
      // Detail view is optional; keep the inline document available on failure.
    } finally {
      setOpeningDocument(false);
    }
  }

  function startConnected(kind: ImageConnectedNodeKind) {
    if (running) return;
    data.onAddConnectedNode(item.id, kind, {
      x: item.x, y: item.y, width: item.width || TEXT_CARD_DEFAULT_WIDTH, height: item.height || TEXT_CARD_DEFAULT_HEIGHT,
      ...(kind === 'storyboard' ? { storyboardEntryMode: 'generate' as const } : {}),
    });
    // Creating a downstream card does not opt the source into manual writing.
    // Selection and composer ownership remain with the newly created card.
  }

  const isEmpty = !item.text?.trim();
  const showInlineEditor = editingInline || item.textEntryMode === 'edit';
  const canGenerate = Boolean(textUiHost?.agentTasksAvailable);
  // Cross-card actions ("build a connected X card") follow the same registry
  // gate as every add-node entry — an unregistered target kind must not
  // appear as a starter/context action either.
  const kindAvailable = useCanvasKindAvailability();
  const downstreamActions = ([
    { kind: 'storyboard', icon: 'storyboard', label: bn().actions.splitStoryboard },
    { kind: 'image', icon: 'image', label: bn().actions.generateImage },
    { kind: 'video', icon: 'video', label: bn().actions.textToVideo },
  ] as const).filter(action => kindAvailable(action.kind));
  // Editing mode persists after leaving a card; only the active selection owns its toolbar.
  const showInlineToolbar = selected;
  // A card stored smaller than its starter panel must grow back — never
  // render the initial actions clipped mid-button.
  React.useEffect(() => {
    if (!isEmpty || showInlineEditor || running) return;
    if ((item.height ?? 0) < TEXT_CARD_DEFAULT_HEIGHT) data.onPatch(item.id, { height: TEXT_CARD_DEFAULT_HEIGHT });
  }, [isEmpty, showInlineEditor, running, item.height, item.id, data]);

  const contextActions = downstreamActions.length ? (
    <div className="basic-text-context-actions nodrag nopan nowheel" role="group" aria-label={bn().actions.continueFromText} onDoubleClick={event => event.stopPropagation()}>
      {downstreamActions.map(action => <Button key={action.kind} type="button" variant="ghost" onClick={event => { event.stopPropagation(); startConnected(action.kind); }}><Icon name={action.icon} size={16} /><span>{action.label}</span></Button>)}
    </div>
  ) : null;

  return (
    <article
      ref={setToolbarContainer}
      data-canvas-node-surface
      className={`basic-text-artifact-node${selected ? ' is-selected' : ''}${openingDocument ? ' is-opening-document' : ''}`}
      tabIndex={0}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={100}
        lineClassName="basic-node-resizer-line"
        handleClassName="basic-node-resizer-handle"
        onResizeEnd={(_, params) => data.onPatch(item.id, { width: params.width, height: params.height })}
      />
      <CanvasNodeLabel
        kind="text"
        title={<span className="basic-node-label-text">{item.title || bn().labels.text}</span>}
        actions={(
          <CanvasNodeActions
            onDuplicate={() => data.onDuplicate(item.id)}
            onRemove={() => data.onRemove(item.id)}
            duplicateLabel={bn().actions.copyText}
            removeLabel={bn().actions.deleteText}
          />
        )}
      />
      {showInlineEditor ? (
        <div ref={inlineEditorRef} className="basic-text-inline-editor nodrag nopan nowheel"
          onFocusCapture={() => { setEditingInline(true); if (!selected) selectText(); }}
          onPointerDown={event => { if (!selected) selectText(); event.stopPropagation(); }}
          onDoubleClick={event => event.stopPropagation()}
          onKeyDownCapture={event => {
            if (!event.nativeEvent.isComposing && event.key === 'Escape' && releaseCanvasInputFocus(event.target)) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          onKeyDown={event => {
            // Portal toolbars share this React ancestry, but are not text inputs.
            // Only the editor owns typing keys; card controls must reach canvas shortcuts.
            if (!(event.target instanceof Element) || !event.target.closest(CANVAS_INPUT_SELECTOR)) return;
            if (!event.defaultPrevented && !event.nativeEvent.isComposing && event.key === 'Escape' && releaseCanvasInputFocus(event.target)) event.preventDefault();
            event.stopPropagation();
          }}
          onWheel={event => event.stopPropagation()}>
          <div className={`basic-text-inline-body ${textToolbarStyles.body}`}>
            {textUiHost?.renderTextEditor
              ? textUiHost.renderTextEditor({
                markdown: item.text || '',
                onChange: text => data.onPatch(item.id, { text }),
                onOpenDetail: () => { void openEditor(); },
                // Keep the floating toolbar outside the editor's clipped, scrollable body.
                renderToolbar: toolbar => showInlineToolbar && toolbarContainer ? createPortal(
                  <CanvasTextToolbar container={toolbarContainer}>
                    <TextToolbarWithChat toolbar={toolbar} node={item} />
                  </CanvasTextToolbar>,
                  toolbarContainer,
                ) : null,
              })
              : <CompositionSafeTextarea aria-label={bn().panels.bodyInCard} value={item.text || ''} onValueChange={text => data.onPatch(item.id, { text })} />}
          </div>
          {contextActions}
        </div>
      ) : running ? (
        <CanvasOutputFrame state="generating">
          <CanvasOutputStatus />
        </CanvasOutputFrame>
      ) : isEmpty ? (
        <div className="basic-text-starter-card node-drag-surface">
          <CanvasNodeStarter
            icon="text"
            actions={<>
              <Button type="button" variant="ghost" onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); beginInlineEditing(); }}><Icon name="edit" size={18} /><span>{bn().panels.writeYourself}</span></Button>
              {downstreamActions.map(action => <Button key={action.kind} type="button" variant="ghost" onClick={event => { event.stopPropagation(); startConnected(action.kind); }}><Icon name={action.icon} size={18} /><span>{action.label}</span></Button>)}
            </>}
          />
        </div>
      ) : (
        <div className="basic-text-result article-review-node node-drag-surface">
          <ResultCard
            artifact={artifact}
            showHeader={false}
            showFooter={false}
            openLabel={bn().actions.selectTextCard}
            onOpen={event => { event.stopPropagation(); beginInlineEditing(); }}
          />
          {contextActions}
        </div>
      )}
      {item.generation?.status === 'failed' && <CanvasErrorNotice placement="card" title={bn().status.genFailed} error={item.generation.error || bn().status.genFailed}>{textUiHost?.openExecutionSettings && <Button type="button" variant="ghost" onClick={textUiHost.openExecutionSettings}>{bn().errors.openExecutionSettings}</Button>}</CanvasErrorNotice>}
      {selected && !showInlineEditor && canGenerate && (
        <CanvasComposerShell
          ownerId={item.id}
          expanded={composerExpanded}
          className="basic-output-composer basic-text-composer"
          aria-label={bn().panels.textGenerationPanel}
          onSubmit={event => { event.preventDefault(); void generateText(); }}
          data-action-ui-id="text-generation-composer"
        >
          <CanvasComposerHeader
            attachmentsLabel={bn().panels.textReferences}
            addLabel={bn().actions.addReference}
            addDisabled={!textUiHost?.selectTextReference || running}
            onAdd={() => textUiHost?.selectTextReference?.(item.id)}
            expanded={composerExpanded}
            onExpand={() => setComposerExpanded(current => !current)}
          >
            {linkedAttachments.map(attachment => <CanvasComposerAttachment key={`${attachment.sourceNodeId}:${attachment.path}`} name={attachment.name} mimeType={attachment.mimeType} src={attachment.mimeType.startsWith('image/') ? projectFileUrl(attachment.path) : undefined} className="is-linked" />)}
          </CanvasComposerHeader>
          <div className="minimax-image-prompt-wrap basic-output-prompt-wrap">
            <CompositionSafeTextarea
              aria-label={bn().panels.textPrompt}
              value={prompt}
              placeholder={bn().panels.textPromptPlaceholder}
              maxLength={7500}
              disabled={running}
              onValueChange={textInstruction => data.onPatch(item.id, { textInstruction })}
              onKeyDown={event => {
                if (event.key !== 'Enter' || event.shiftKey) return;
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }}
            />
          </div>
          <div className="minimax-image-toolbar basic-output-toolbar">
            <div className="minimax-image-toolbar-left basic-output-options">
              <TextGenerationOptionControls value={item.textOptions || {}} onChange={textOptions => data.onPatch(item.id, { textOptions })}/>
            </div>
            <div className="minimax-image-toolbar-right"><Button type="submit" variant="primary" size="icon" className="minimax-image-submit basic-output-submit" disabled={running || !hasInstruction} aria-label={running ? bn().status.generating : bn().actions.generateText}>{running ? <span className="basic-output-spinner" /> : '↑'}</Button></div>
          </div>
        </CanvasComposerShell>
      )}
      <Handle type="target" position={Position.Left} className="basic-node-handle basic-node-handle-target" />
      <CanvasNodeSourceHandle onAddNode={kind => startConnected(kind)} />
    </article>
  );
}

function OutputIcon({ format }: { format: 'html' | 'presentation' }) {
  return format === 'html'
    ? <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M3 8h18M7 6h.01M10 6h.01M13 6h.01M7 12h10M7 15h6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>
    : <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="16" height="13" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M12 16v5M8.5 21h7M8 7h8M8 10h5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>;
}

function PageBody({ node, selected, generationProgress, versions, onRemoveReference, onCommit, onPresentationOptionsChange, onWebpageOptionsChange, onGeneration }: { node: CanvasBasicNode; selected: boolean; generationProgress?: BasicCanvasNodeData['generationProgress']; versions?: React.ReactNode; onRemoveReference?: BasicCanvasNodeData['onRemoveReference']; onCommit: (text: string) => void; onPresentationOptionsChange: (options: NonNullable<CanvasBasicNode['presentationOptions']>) => void; onWebpageOptionsChange: (options: NonNullable<CanvasBasicNode['webpageOptions']>) => void; onGeneration: (generation: CanvasBasicNode['generation']) => void }) {
  const uiHost = useCanvasUiHost();
  const { detail, nearby } = useCanvasRenderDetail();
  const isCanvasInteractionActive = useCanvasInteractionStatus();
  const [value, setValue] = React.useState(node.text || '');
  const [busy, setBusy] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const cancelReference = React.useRef<(() => void) | void>();
  React.useEffect(() => () => cancelReference.current?.(), [selected, node.id]);
  const format = node.artifactFormat ?? 'html';
  const isPresentation = format === 'presentation';
  const presentationOptions: NonNullable<CanvasBasicNode['presentationOptions']> = node.presentationOptions ?? { length: 'standard', template: 'smart', templateTitle: bn().lengths.smartMatch };
  const webpageOptions: NonNullable<CanvasBasicNode['webpageOptions']> = node.webpageOptions ?? {};
  const linkedAttachments = node.linkedAttachments || [];
  const progressStatus = generationProgress?.binding.requestId === node.generation?.requestId
    ? generationProgress?.status
    : undefined;
  const running = busy || progressStatus === 'running' || (!progressStatus && node.generation?.status === 'running');
  const failed = !running && (progressStatus ? progressStatus === 'failed' : node.generation?.status === 'failed');
  const generationError = (progressStatus ? generationProgress?.error : undefined) || node.generation?.error || bn().status.retryAfterEdit;
  const previewPath = node.projectFilePath || node.generation?.previewPath;
  const totalSlides = node.generation?.totalSlides ?? 0;
  const [filePreviewRevision, setFilePreviewRevision] = React.useState(0);
  const fileFingerprintRef = React.useRef('');
  const previewFrameRef = React.useRef<HTMLIFrameElement | null>(null);
  const eventPreviewRevision = generationProgress?.previewRevision ?? 0;
  const previewRevision = Math.max(eventPreviewRevision, filePreviewRevision);
  // Candidate progress is not evidence that the published project file exists.
  const [verifiedPreviewUrl, setVerifiedPreviewUrl] = React.useState('');
  const previewUrl = previewPath ? projectFileUrl(previewPath) : '';
  const previewReady = Boolean(previewUrl && verifiedPreviewUrl === previewUrl);
  const previewSrc = previewUrl
    ? `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}live=${filePreviewRevision}`
    : '';
  const completedSlides = Math.max(0, Math.min(totalSlides, previewRevision - 1));
  const progressDetail = generationProgress?.detail
    || (previewRevision === 0
      ? bn().status.planningOutline
      : filePreviewRevision > 0 && eventPreviewRevision === 0
        ? bn().status.livePreviewUpdated
        : previewRevision === 1
          ? bn().status.deckSkeleton
          : bn().status.slidesProgress(completedSlides, totalSlides));
  React.useEffect(() => {
    fileFingerprintRef.current = '';
    setFilePreviewRevision(0);
  }, [previewUrl]);
  React.useEffect(() => {
    if (!previewUrl) return;
    let disposed = false;
    let inFlight = false;
    // Completed previews still get their initial probe. Live revisions catch up
    // on the next tick after interaction; keep the existing iframe mounted.
    const deferLiveRefresh = () => running && (
      document.visibilityState !== 'visible' || isCanvasInteractionActive()
    );
    const probe = async () => {
      if (disposed || inFlight || deferLiveRefresh()) return;
      inFlight = true;
      try {
        const response = await fetch(previewUrl, { method: 'HEAD', cache: 'no-store' });
        if (disposed || deferLiveRefresh()) return;
        if (!response.ok) { setVerifiedPreviewUrl(''); return; }
        setVerifiedPreviewUrl(previewUrl);
        const fingerprint = [
          response.headers.get('etag'),
          response.headers.get('last-modified'),
          response.headers.get('content-length'),
        ].filter(Boolean).join(':');
        if (fingerprint !== fileFingerprintRef.current || !fileFingerprintRef.current) {
          fileFingerprintRef.current = fingerprint;
          setFilePreviewRevision(revision => revision + 1);
        }
      } catch {
        // The stable output path returns 404 until the first valid preview exists.
      } finally {
        inFlight = false;
      }
    };
    void probe();
    if (!running) return () => { disposed = true; };
    const timer = window.setInterval(() => { void probe(); }, 1_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [previewUrl, running, isCanvasInteractionActive]);
  React.useEffect(() => setValue(node.text || ''), [node.text]);
  function preparePreviewFrame(frame: HTMLIFrameElement) {
    previewFrameRef.current = frame;
    if (!uiHost?.renderArtifactPreview) uiHost?.cacheArtifactThumbnail?.(previewSrc, frame);
    if (!isPresentation) return;
    try {
      const document = frame.contentDocument;
      if (!document || document.querySelector('style[data-da-canvas-preview]')) return;
      const style = document.createElement('style');
      style.dataset.daCanvasPreview = 'true';
      // Hide only presentation navigation, not generic .controls inside slide
      // content. Keep the DOM alive: the host pager invokes its click handlers.
      style.textContent = bn().pagerHideCss;
      document.head.appendChild(style);
    } catch {
      // The preview remains readable even when a non-standard renderer blocks DOM access.
    }
  }

  function stepPreview(direction: 'previous' | 'next') {
    const frame = previewFrameRef.current;
    const contentWindow = frame?.contentWindow;
    const document = frame?.contentDocument;
    if (!contentWindow || !document) return;
    const label = direction === 'previous' ? bn().actions.prev : bn().actions.next;
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find(candidate => candidate.getAttribute('aria-label') === label || candidate.textContent?.trim() === label);
    if (button) {
      button.click();
      return;
    }
    contentWindow.dispatchEvent(new KeyboardEvent('keydown', {
      key: direction === 'previous' ? 'ArrowLeft' : 'ArrowRight',
      bubbles: true,
    }));
  }

  async function submit() {
    if (running || (!value.trim() && linkedAttachments.length === 0)) return;
        const effectivePrompt = value.trim() || (isPresentation
          ? bn().prompts.pptFromAttachments
          : bn().prompts.webFromAttachments);
        const requestId = globalThis.crypto.randomUUID();
        const presentationTask = isPresentation ? createPresentationGenerationTask(
          normalizeCanvasPresentationGenerationIntent({ prompt: effectivePrompt, ...presentationOptions }),
          requestId,
        ) : null;
        const webpageTask = !isPresentation ? createWebpageGenerationTask(
          normalizeCanvasWebpageGenerationIntent({ prompt: effectivePrompt, ...webpageOptions }),
          requestId,
        ) : null;
        const outputPath = presentationTask?.outputPath ?? webpageTask!.outputPath;
        const totalSlides = presentationTask?.totalSlides;
        onCommit(value);
        onGeneration({ requestId, status: 'running', previewPath: outputPath, ...(totalSlides ? { totalSlides } : {}) });
        setBusy(true);
        try {
          const attachmentFiles = await Promise.all(linkedAttachments.map(loadLinkedAttachmentFile));
          const executionPrompt = presentationTask
            ? `${presentationTask.agentPrompt}${attachmentFiles.length > 0 ? bn().prompts.pptKeepUpstream : ''}`
            : `${webpageTask!.agentPrompt}${attachmentFiles.length > 0 ? bn().prompts.webKeepUpstream : ''}`;
          await submitAgentTask(executionPrompt, {
            kind: 'instruction-card', title: isPresentation ? bn().actions.generatePpt : bn().actions.generateWeb, visiblePrompt: isPresentation
              ? presentationTask?.visiblePrompt
              : webpageTask?.visiblePrompt,
            canvasArtifactGeneration: { requestId, nodeId: node.id, format, outputPath },
            taskContext: {
              targetLabel: isPresentation ? bn().labels.pptCard : bn().labels.webCard,
              baseVersionKind: 'target-snapshot',
              baseVersionSource: JSON.stringify({
                text: value,
                format,
                options: isPresentation ? presentationOptions : webpageOptions,
                attachments: linkedAttachments.map(attachment => ({
                  name: attachment.name,
                  path: attachment.path,
                })),
              }),
            },
            ...(!isPresentation && webpageTask?.designSystemId
              ? { designSystemId: webpageTask.designSystemId }
              : {}),
          }, attachmentFiles);
        } catch (error) { onGeneration({ requestId, status: 'failed', error: error instanceof Error ? error.message : bn().errors.startFailed }); } finally { setBusy(false); }
  }

  return (
    <>
      <CanvasOutputFrame state={running ? 'generating' : failed ? 'failed' : previewReady ? 'preview' : 'empty'}>
        {previewReady ? <>
          {uiHost?.renderArtifactPreview ? uiHost.renderArtifactPreview({ src: previewSrc, title: node.title, presentation: isPresentation, detail, nearby, onFrameReady: preparePreviewFrame }) : detail ? <iframe ref={previewFrameRef} key={`${previewPath}:${previewRevision}`} className="basic-output-live-preview nodrag nopan" src={previewSrc} title={isPresentation ? bn().panels.pptLivePreview : bn().panels.webLivePreview} sandbox="allow-scripts allow-same-origin" onLoad={event => preparePreviewFrame(event.currentTarget)} /> : <div className="canvas-static-preview" data-canvas-preview="static">
            {nearby && uiHost?.renderArtifactThumbnail ? uiHost.renderArtifactThumbnail({ src: previewSrc, title: node.title, presentation: isPresentation }) : <span>{node.title || (isPresentation ? 'PPT' : bn().labels.web)}</span>}
          </div>}
          {isPresentation && selected && <div className="basic-output-preview-nav nodrag nopan" aria-label={bn().panels.pptPager} onPointerDown={event => event.stopPropagation()}>
            <Button variant="ghost" size="icon" aria-label={bn().actions.prevSlide} onClick={() => stepPreview('previous')}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 5-5 5 5 5" /></svg></Button>
            <Button variant="ghost" size="icon" aria-label={bn().actions.nextSlide} onClick={() => stepPreview('next')}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 5 5 5-5 5" /></svg></Button>
          </div>}
          {failed && <div className={`nodrag nopan nowheel ${pageStyles.failure}`} role="alert" onPointerDown={event => event.stopPropagation()}>
            <strong>{bn().status.genFailed}</strong><span>{bn().status.previousPreview}</span><span>{generationError}</span>
          </div>}
        </> : running ? <CanvasOutputStatus detail={progressDetail} />
          : failed ? <div className="basic-output-state is-error" role="alert"><strong>{bn().status.genFailed}</strong><span>{generationError}</span></div>
            : <div className="basic-output-empty"><OutputIcon format={format} /></div>}
      </CanvasOutputFrame>
      {selected && previewReady && <div className="minimax-image-upload basic-output-edit basic-output-primary-actions nodrag nopan" role="group" aria-label={isPresentation ? bn().panels.pptActions : bn().panels.webActions} onPointerDown={event => event.stopPropagation()}>
        <Button
          variant="ghost"
          className="basic-output-open"
          aria-label={isPresentation ? bn().actions.editPpt : bn().actions.editWeb}
          onClick={() => { void openArtifact({ kind: 'project-file', path: previewPath!, mimeType: 'text/html' }); }}
        ><OutputIcon format={format} /><span>{isPresentation ? bn().actions.editPpt : bn().actions.editWeb}</span></Button>
        <CanvasSaveAssetButton nodeId={node.id} />
        <span className="basic-output-primary-divider" aria-hidden="true" />
        <CanvasSendToChatButton node={node} className="basic-output-send-to-chat" />
      </div>}
      {selected && <CanvasComposerShell ownerId={node.id} expanded={expanded} className="basic-output-composer" onSubmit={event => { event.preventDefault(); void submit(); }}>
        {versions}
        <CanvasComposerHeader
          attachmentsLabel={bn().panels.upstreamAttachments}
          addLabel={bn().actions.addReference}
          addDisabled={running || !uiHost?.selectTextReference}
          onAdd={() => { cancelReference.current?.(); cancelReference.current = uiHost?.selectTextReference?.(node.id); }}
          expanded={expanded}
          onExpand={() => setExpanded(current => !current)}
        >
            {linkedAttachments.map(attachment => (
              <CanvasComposerAttachment
                key={`${attachment.sourceNodeId}:${attachment.path}`}
                name={attachment.name}
                mimeType={attachment.mimeType}
                src={attachment.mimeType.startsWith('image/') ? projectFileUrl(attachment.path) : undefined}
                className="is-linked"
              >{onRemoveReference && <Button type="button" variant="ghost" size="icon" disabled={running} aria-label={bn().actions.removeReference(attachment.name)} onClick={() => onRemoveReference(node.id, attachment.sourceNodeId)}>×</Button>}</CanvasComposerAttachment>
            ))}
        </CanvasComposerHeader>
        <div className="minimax-image-prompt-wrap basic-output-prompt-wrap">
          <CompositionSafeTextarea ref={textareaRef} value={value} maxLength={7500} disabled={running} onValueChange={setValue} onValueCommit={onCommit} placeholder={isPresentation ? bn().panels.pptPromptPlaceholder : bn().panels.webPromptPlaceholder} aria-label={isPresentation ? bn().panels.pptPrompt : bn().panels.webPrompt} />
          <span className="minimax-image-prompt-count">{value.length} / 7500</span>
        </div>
        <div className="minimax-image-toolbar basic-output-toolbar">
          <div className="minimax-image-toolbar-left">
            <PageGenerationOptionControls isPresentation={isPresentation} presentationOptions={presentationOptions} webpageOptions={webpageOptions} onPresentationOptionsChange={onPresentationOptionsChange} onWebpageOptionsChange={onWebpageOptionsChange}/>
          </div>
          <div className="minimax-image-toolbar-right"><Button type="submit" variant="primary" size="icon" className="minimax-image-submit basic-output-submit" disabled={running || (!value.trim() && linkedAttachments.length === 0)} aria-label={running ? bn().status.generating : isPresentation ? bn().actions.generatePpt : bn().actions.generateWeb}>{running ? <span className="basic-output-spinner" /> : '↑'}</Button></div>
        </div>

      </CanvasComposerShell>}
    </>
  );
}

function CanvasSendToChatButton({ node, className, disabled }: { node: CanvasBasicNode; className?: string; disabled?: boolean }) {
  const [error, setError] = React.useState('');
  const stage = () => {
    try { stageCanvasObject(canvasObjectReference(getCanvasHostContext().projectId, node, 'reference')); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : bn().status.cannotConnectChat); }
  };
  return <>
    <Button type="button" variant="ghost" className={`bezier-tooltip ${className || ''} `} data-tooltip={bn().actions.addToChat} aria-label={bn().actions.sendToChat} title={error || bn().actions.sendToChat} disabled={disabled} onClick={stage}><ChatAddIcon /></Button>
    {error ? <span className="sr-only" role="alert">{error}</span> : null}
  </>;
}

function TextToolbarWithChat({ toolbar, node }: { toolbar: React.ReactNode; node: CanvasBasicNode }) {
  if (!React.isValidElement<{ children?: React.ReactNode }>(toolbar)) return <>{toolbar}</>;
  // Appended actions stay visible in every state — greyed until the card has
  // content worth saving/sending, never hidden.
  const noContent = !node.text?.trim();
  return React.cloneElement(toolbar, undefined,
    <>
      {toolbar.props.children}
      <span className="markdown-word-toolbar-divider" aria-hidden="true" />
      <CanvasSaveAssetButton nodeId={node.id} className="markdown-word-tool" disabled={noContent} />
      <span className="markdown-word-toolbar-divider" aria-hidden="true" />
      <CanvasSendToChatButton node={node} className="markdown-word-tool" disabled={noContent} />
    </>,
  );
}

function PageCanvasNode({
  data,
  selected,
  versions,
}: Pick<NodeProps<Node<BasicCanvasNodeData>>, 'data' | 'selected'> & { versions?: React.ReactNode }) {
  const item = data.node;
  const defaultTitle = item.artifactFormat === 'presentation' ? 'PPT' : bn().labels.web;
  const visibleTitle = [bn().labels.artifact, bn().labels.page].includes(item.title) ? defaultTitle : item.title;

  return (
    <CanvasOutputNode
      selected={selected}
      title={visibleTitle}
      icon={<OutputIcon format={item.artifactFormat ?? 'html'} />}
      minWidth={HTML_PAGE_CARD_SIZE.width}
      minHeight={HTML_PAGE_CARD_SIZE.height}
      keepAspectRatio
      onRemove={() => data.onRemove(item.id)}
      onDuplicate={() => data.onDuplicate(item.id)}
      onResizeEnd={(width, height) => data.onPatch(item.id, { width, height })}
      sourceOrigin={{
        x: item.x,
        y: item.y,
        width: Math.max(item.width || 0, HTML_PAGE_CARD_SIZE.width),
        height: Math.max(item.height || 0, HTML_PAGE_CARD_SIZE.height),
      }}
      onAddConnectedNode={(kind, origin) => data.onAddConnectedNode(item.id, kind, origin)}
    >
      <PageBody node={item} selected={Boolean(selected)} generationProgress={data.generationProgress} versions={versions} onRemoveReference={data.onRemoveReference} onCommit={text => data.onPatch(item.id, { text })} onPresentationOptionsChange={presentationOptions => data.onPatch(item.id, { presentationOptions })} onWebpageOptionsChange={webpageOptions => data.onPatch(item.id, { webpageOptions })} onGeneration={generation => data.onPatch(item.id, { generation })} />
    </CanvasOutputNode>
  );
}

function CanvasArtifactNode({
  data,
  selected,
}: Pick<NodeProps<Node<BasicCanvasNodeData>>, 'data' | 'selected'>) {
  const item = data.node;
  const artifact = item.artifact;

  if (!artifact) {
    return (
      <article data-canvas-node-surface className={`basic-canvas-node basic-canvas-artifact-node${selected ? ' is-selected' : ''}`}>
        <div className="canvas-artifact-missing">{bn().status.artifactStale}</div>
      </article>
    );
  }

  return (
    <article
      data-canvas-node-surface
      className={`basic-canvas-node basic-canvas-artifact-node${selected ? ' is-selected' : ''}`}
      tabIndex={0}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={320}
        minHeight={260}
        lineClassName="basic-node-resizer-line"
        handleClassName="basic-node-resizer-handle"
        onResizeEnd={(_, params) => data.onPatch(item.id, { width: params.width, height: params.height })}
      />
      {/* 复制/移出原本是 ResultCard 页脚里的两个文字按钮。挪到统一的操作条上
          —— 页脚那两个是「卡片级」动作，和旁边的「打开详情」（内容级）混排在
          一起读起来是同一类，实际不是；其他卡片也已经统一在右上角浮出。 */}
      <CanvasNodeActions
        floating
        onDuplicate={() => data.onDuplicate(item.id)}
        onRemove={() => data.onRemove(item.id)}
        duplicateLabel={bn().actions.copyCard}
        removeLabel={bn().actions.removeFromCanvas}
      />
      {selected && artifact.resource.kind === 'project-file' && <div className="image-action-capsule nodrag nopan"><CanvasSaveAssetButton nodeId={item.id} /></div>}
      <ResultCard
        artifact={artifact}
        onOpen={() => { void openArtifact(artifact.resource); }}
      />
      <Handle type="target" position={Position.Left} className="basic-node-handle basic-node-handle-target" />
      <CanvasNodeSourceHandle onAddNode={kind => data.onAddConnectedNode(item.id, kind, {
        x: item.x,
        y: item.y,
        width: Math.max(item.width || 0, 320),
        height: Math.max(item.height || 0, 260),
      })} />
    </article>
  );
}

function ImageBody({ onPick }: { onPick: (file: File) => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <div
      className="basic-node-image-drop nodrag"
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click(); }}
      onDragOver={event => { event.preventDefault(); event.stopPropagation(); }}
      onDrop={event => {
        event.preventDefault();
        event.stopPropagation();
        const file = Array.from(event.dataTransfer.files).find(item => item.type.startsWith('image/'));
        if (file) onPick(file);
      }}
    >
      <NodeGlyph kind="image" />
      <strong>{bn().actions.addImage}</strong>
      <span>{bn().panels.clickOrDropImage}</span>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={event => {
          const file = event.target.files?.[0];
          if (file) onPick(file);
          event.currentTarget.value = '';
        }}
      />
    </div>
  );
}

function StoryboardArtifactNode({
  data,
  selected,
}: Pick<NodeProps<Node<BasicCanvasNodeData>>, 'data' | 'selected'>) {
  const item = data.node;
  const sourceDocuments = (item.linkedAttachments || []).filter(attachment => !attachment.mimeType.startsWith('image/'));
  const running = item.generation?.status === 'running';
  const editorWidth = item.storyboard
    ? ((item.width || 0) < STORYBOARD_EDITOR_MIN_WIDTH ? STORYBOARD_EDITOR_DEFAULT_WIDTH : item.width!)
    : item.width || STORYBOARD_CARD_DEFAULT_WIDTH;
  const editorHeight = item.storyboard
    ? item.height || storyboardEditorHeight(item.storyboard.shots.length)
    : item.height || STORYBOARD_CARD_DEFAULT_HEIGHT;

  React.useEffect(() => {
    if (!item.storyboard) return;
    const patch: Partial<CanvasBasicNode> = {};
    if ((item.width || 0) < STORYBOARD_EDITOR_MIN_WIDTH) patch.width = STORYBOARD_EDITOR_DEFAULT_WIDTH;
    if (item.height !== editorHeight) patch.height = editorHeight;
    if (Object.keys(patch).length > 0) data.onPatch(item.id, patch);
  }, [data, editorHeight, item.height, item.id, item.storyboard, item.width]);

  async function generateStoryboardScript() {
    const supplemental = item.storyboardPrompt?.trim() || '';
    if ((sourceDocuments.length === 0 && !supplemental) || running) return;
    const requestId = globalThis.crypto.randomUUID();
    const plan = item.storyboard || createDefaultStoryboardPlan();
    data.onPatch(item.id, { generation: {
      requestId, status: 'running', baseStoryboard: JSON.stringify(item.storyboard ?? null),
    } });
    try {
      const files = await Promise.all(sourceDocuments.map(loadLinkedAttachmentFile));
      await submitAgentTask(buildStoryboardGenerationPrompt(plan, supplemental, item.storyboardGenerationType || 'general', data.storyboardLibrary?.assets || [], item.storyboardRequirements), {
        kind: 'instruction-card',
        title: bn().actions.generateVideoStoryboard,
        visiblePrompt: sourceDocuments.length ? bn().prompts.storyboardFromDoc(sourceDocuments[0]!.name) : bn().actions.generateStoryboardScript,
        canvasTextGeneration: { requestId, nodeId: item.id, outputKind: 'storyboard' },
        taskContext: {
          targetLabel: bn().labels.storyboardCard,
          baseVersionKind: 'target-snapshot',
          baseVersionSource: JSON.stringify({
            storyboard: plan,
            supplemental,
            generationType: item.storyboardGenerationType || 'general',
            sources: sourceDocuments.map(source => ({ name: source.name, path: source.path })),
          }),
        },
      }, files);
    } catch (error) {
      data.onPatch(item.id, {
        generation: {
          requestId,
          status: 'failed',
          error: error instanceof Error ? error.message : bn().status.chatUnavailable,
        },
      });
    }
  }

  function chooseTextGeneration() {
    if (sourceDocuments.length > 0 || !data.onAddUpstreamTextNode) {
      data.onPatch(item.id, { storyboardEntryMode: 'generate' });
      return;
    }
    data.onAddUpstreamTextNode(item.id, {
      x: item.x,
      y: item.y,
      width: item.width || STORYBOARD_CARD_DEFAULT_WIDTH,
      height: item.height || STORYBOARD_CARD_DEFAULT_HEIGHT,
    });
  }

  return (
    <CanvasOutputNode
      className="storyboard-output-generator"
      excludedNodeKinds={excludedCanvasDownstreamKinds('storyboard')}
      icon={<Icon name="storyboard" size={18} />}
      title={item.title || bn().labels.storyboardScript}
      minWidth={item.storyboard ? STORYBOARD_EDITOR_MIN_WIDTH : STORYBOARD_CARD_DEFAULT_WIDTH}
      minHeight={item.storyboard ? editorHeight : 420}
      maxHeight={item.storyboard ? editorHeight : undefined}
      selected={selected}
      sourceOrigin={{
        x: item.x,
        y: item.y,
        width: editorWidth,
        height: editorHeight,
      }}
      onRemove={() => data.onRemove(item.id)}
      onDuplicate={() => data.onDuplicate(item.id)}
      onResizeEnd={(width, height) => data.onPatch(item.id, {
        width,
        height: item.storyboard ? editorHeight : height,
      })}
      onAddConnectedNode={(kind, origin) => data.onAddConnectedNode(item.id, kind, origin)}
    >
      {selected && !!item.storyboard?.shots.length && <div className="image-action-capsule nodrag nopan"><CanvasSaveAssetButton nodeId={item.id} /><span className="image-capsule-divider" aria-hidden="true" /><CanvasSendToChatButton node={item} /></div>}
      <CanvasOutputFrame state={running ? 'generating' : item.storyboard ? 'preview' : item.generation?.status === 'failed' ? 'failed' : 'empty'}>
        {item.storyboard ? (
          <StoryboardCanvasBody
            onHeightChange={height => { if (item.height !== height) data.onPatch(item.id, { height }); }}
            library={data.storyboardLibrary}
            plan={item.storyboard}
            onChange={storyboard => data.onPatch(item.id, {
              storyboard,
              height: storyboardEditorHeight(storyboard.shots.length),
            })}
            onCreateImageNode={shot => {
              const plan = item.storyboard!;
              const assets = data.storyboardLibrary?.assets || [];
              const refs = storyboardShotReferences(shot, assets);
              const references = refs.map(({ asset, variant }) => ({ assetId: asset.id, name: asset.name, path: variant?.referencePath || storyboardReferenceImage(variant, data.storyboardLibrary?.images || [])?.path }));
              const prompt = [buildStoryboardShotPrompt(plan, shot), storyboardReferenceContext(shot, assets), storyboardReferenceImageLabels(references, assets)].filter(Boolean).join('\n\n');
              const attachments = refs.flatMap(({ asset, variant }) => {
                const image = storyboardReferenceImage(variant, data.storyboardLibrary?.images || []);
                const path = variant?.referencePath || image?.path;
                return path ? [{ name: bn().prompts.refImage(asset.name), path, mimeType: 'image/png', size: 0 }] : [];
              });
              const imageInputSignature = JSON.stringify({ prompt, attachments, ratio: plan.aspectRatio });
              if (shot.imageNodeId && shot.imageInputSignature === imageInputSignature && data.storyboardLibrary?.imageNodeIds?.includes(shot.imageNodeId)) { data.onSelect?.(shot.imageNodeId); return; }
              const imageNodeId = data.onAddConnectedNode(item.id, 'image', {
                skipSourceContext: true,
                x: item.x,
                y: item.y,
                width: editorWidth,
                height: editorHeight,
                prompt,
                attachments,
                imageRatio: plan.aspectRatio,
              });
              if (imageNodeId) data.onPatch(item.id, { storyboard: { ...plan, shots: plan.shots.map(s => s.id === shot.id ? { ...s, imageNodeId, imageInputSignature,
                selectedImagePath: selectedStoryboardShotImage(s, data.storyboardLibrary?.images || [])?.path,
                imageSources: { ...s.imageSources, [imageNodeId]: { prompt, references: refs.map(({ asset, variant }) => ({ assetId: asset.id, name: asset.name, path: variant?.referencePath, revision: asset.revision })) } },
                imageNodeHistoryIds: [...new Set([...(s.imageNodeHistoryIds || []), ...(s.imageNodeId ? [s.imageNodeId] : [])])], imageAssetRevisions: Object.fromEntries(refs.map(({ asset }) => [asset.id, asset.revision])) } : s) } });
            }}
          />
        ) : running ? (
          <CanvasOutputStatus detail={bn().status.readingForShots} />
        ) : item.storyboardEntryMode === 'generate' ? (
          <div className="basic-output-empty"><Icon name="storyboard" size={52} strokeWidth={1.7} /></div>
        ) : (
          <StoryboardEntryBody
            onChooseGenerate={chooseTextGeneration}
            onChooseEdit={() => data.onPatch(item.id, {
              storyboardEntryMode: 'edit',
              storyboard: createDefaultStoryboardPlan(),
              generation: undefined,
              width: STORYBOARD_EDITOR_DEFAULT_WIDTH,
              height: STORYBOARD_EDITOR_MIN_HEIGHT,
            })}
          />
        )}
        {item.generation?.status === 'failed' && <CanvasErrorNotice placement="card" title={bn().status.genFailed} error={item.generation.error || bn().status.genFailed} />}
      </CanvasOutputFrame>
      {selected && !item.storyboard && item.storyboardEntryMode === 'generate' ? (
        <StoryboardGenerationComposer
          ownerId={item.id}
          generationType={item.storyboardGenerationType || 'general'}
          prompt={item.storyboardPrompt || ''}
          linkedAttachments={item.linkedAttachments || []}
          generation={item.generation}
          onGenerationTypeChange={storyboardGenerationType => data.onPatch(item.id, { storyboardGenerationType })}
          onPromptChange={storyboardPrompt => data.onPatch(item.id, { storyboardPrompt })}
          onGenerate={() => { void generateStoryboardScript(); }}
        />
      ) : null}
    </CanvasOutputNode>
  );
}

function SketchCanvasNode({ data, selected }: { data: BasicCanvasNodeData; selected?: boolean }) {
  const flush = useCanvasFlush();
  const host = useCanvasUiHost();
  const item = data.node;
  return <CanvasOutputNode
    className="basic-sketch-node"
    icon={<Icon name="edit" size={18} />}
    title={item.title}
    selected={selected}
    minWidth={280}
    minHeight={200}
    sourceOrigin={{ x: item.x, y: item.y, width: item.width || 420, height: item.height || 300 }}
    onResizeEnd={(width, height) => data.onPatch(item.id, { width, height })}
    onRemove={() => data.onRemove(item.id)}
    onDuplicate={() => data.onDuplicate(item.id)}
    onAddConnectedNode={(kind, origin) => data.onAddConnectedNode(item.id, kind, origin)}
  >
    <CanvasOutputFrame state="preview">
      {host?.renderSketch?.({ path: item.projectFilePath || `canvas-${item.id}.sketch.json`, nodeId: item.id, selected: Boolean(selected), pending: item.sketchPending === true, onCreated: async () => { if (item.sketchPending) { data.onPatch(item.id, { sketchPending: false }); await flush(['workbenchBasicNodes']); } } })}
    </CanvasOutputFrame>
  </CanvasOutputNode>;
}

/** Generic card shell shared by core image cards, unknown kinds and registered
 * card packs: resizer + title bar + handles are platform-owned, `children` is
 * the card body. */
function GenericCardShell({ data, selected, children }: { data: BasicCanvasNodeData; selected: boolean; children?: React.ReactNode }) {
  const item = data.node;
  const [renaming, setRenaming] = React.useState(false);
  const [title, setTitle] = React.useState(item.title);
  React.useEffect(() => setTitle(item.title), [item.title]);

  function commitTitle() {
    const next = title.trim() || item.title;
    setTitle(next);
    data.onPatch(item.id, { title: next });
    setRenaming(false);
  }

  return (
    <article
      data-canvas-node-surface
      className={`basic-canvas-node basic-canvas-node-${item.kind}${selected ? ' is-selected' : ''}`}
      tabIndex={0}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={260}
        minHeight={190}
        lineClassName="basic-node-resizer-line"
        handleClassName="basic-node-resizer-handle"
        onResizeEnd={(_, params) => data.onPatch(item.id, { width: params.width, height: params.height })}
      />
      <CanvasNodeLabel
        kind={item.kind}
        title={renaming ? (
          <CompositionSafeInput
            className="basic-node-title-input nodrag"
            autoFocus
            value={title}
            onValueChange={setTitle}
            onBlur={commitTitle}
            onKeyDown={event => {
              if (event.key === 'Enter') commitTitle();
              if (event.key === 'Escape') { setTitle(item.title); setRenaming(false); }
            }}
          />
        ) : (
          <Button variant="ghost" className="basic-node-title" onDoubleClick={() => setRenaming(true)}>{item.title}</Button>
        )}
        actions={(
          <CanvasNodeActions
            onDuplicate={() => data.onDuplicate(item.id)}
            onRemove={() => data.onRemove(item.id)}
          />
        )}
      />

      {children}
      <Handle type="target" position={Position.Left} className="basic-node-handle basic-node-handle-target" />
      <CanvasNodeSourceHandle onAddNode={kind => data.onAddConnectedNode(item.id, kind, {
        x: item.x,
        y: item.y,
        width: item.kind === 'storyboard' ? Math.max(item.width || 0, 480) : Math.max(item.width || 0, 260),
        height: item.kind === 'storyboard' ? Math.max(item.height || 0, 380) : Math.max(item.height || 0, 190),
      })} />
    </article>
  );
}

function openBrowserNode(nodeId: string) {
  window.dispatchEvent(new CustomEvent('bezier-design:open-browser-node', { detail: { nodeId } }));
}

function BrowserCanvasNode({ data, selected }: { data: BasicCanvasNodeData; selected?: boolean }) {
  const item = data.node;
  return (
    <GenericCardShell data={data} selected={Boolean(selected)}>
      <div
        className="nodrag nopan"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 16 }}
        onDoubleClick={event => { event.stopPropagation(); openBrowserNode(item.id); }}
      >
        <Button type="button" variant="primary" onClick={event => { event.stopPropagation(); openBrowserNode(item.id); }}>打开浏览器</Button>
      </div>
    </GenericCardShell>
  );
}

function BasicCanvasNodeComponent({ data, selected }: NodeProps<Node<BasicCanvasNodeData>>) {
  // Registered card packs take precedence — a pack may declare a core kind to
  // override its built-in body, or a `card.<team>.<name>` kind for new cards.
  const PackRenderer = cardRendererFor(data.node.kind);
  if (PackRenderer) {
    return (
      <GenericCardShell data={data} selected={Boolean(selected)}>
        <PackRenderer node={data.node} selected={Boolean(selected)} onPatch={patch => data.onPatch(data.node.id, patch)} />
      </GenericCardShell>
    );
  }
  // Read compatibility for persisted placeholder cards; retain node identity and edges.
  if (data.node.kind === 'artifact' && data.node.artifact) {
    const projection = canvasArtifactProjection(data.node.artifact);
    const projected = {...data,node:{...data.node,...projection}};
    if (projection.kind === 'page') return <PageCanvasNode data={projected} selected={selected} />;
    if (projection.kind === 'video') return <VideoCanvasNode data={projected} selected={selected} />;
    if (projection.kind === 'text') return <TextArtifactNode data={projected} selected={selected} />;
  }
  if (data.node.kind === 'sketch') return <SketchCanvasNode data={data} selected={selected} />;
  if (data.node.kind === 'browser') return <BrowserCanvasNode data={data} selected={selected} />;
  if (data.node.kind === 'video') return <VideoCanvasNode data={data} selected={selected} />;
  const item = data.node;
  const versions = selected ? <CanvasResultHistory
    history={item.resultHistory}
    current={item.kind === 'page' ? { projectFilePath: item.projectFilePath } : item.kind === 'storyboard' ? { storyboard: item.storyboard } : { text: item.text }}
    disabled={item.generation?.status === 'running'}
    onSelect={snapshot => data.onPatch(item.id, {
      ...(item.kind === 'page' ? { projectFilePath: snapshot.projectFilePath as string } : item.kind === 'storyboard' ? { storyboard: snapshot.storyboard as StoryboardPlan } : { text: snapshot.text as string }),
      generation: undefined,
    })}
  /> : null;
  if (item.kind === 'text') return <><TextArtifactNode data={data} selected={selected} />{versions}</>;
  if (item.kind === 'artifact') return <CanvasArtifactNode data={data} selected={selected} />;
  if (item.kind === 'page') return <PageCanvasNode data={data} selected={selected} versions={versions} />;
  if (item.kind === 'storyboard') return <><StoryboardArtifactNode data={data} selected={selected} />{versions}</>;

  return (
    <GenericCardShell data={data} selected={Boolean(selected)}>
      {item.kind === 'image' && <ImageBody onPick={file => data.onPickImage(item.id, file)} />}
    </GenericCardShell>
  );
}

/**
 * React Flow changes position-related node props on every drag frame. The card
 * body does not read those props: its visual position is owned by React Flow's
 * outer node wrapper. Keep the expensive editors, previews and media controls
 * out of that hot path, while still re-rendering whenever business data or
 * selection actually changes.
 */
export const BasicCanvasNode = React.memo(
  function BasicCanvasNodeWithPolicy(props: NodeProps<Node<BasicCanvasNodeData>>) {
    return <CanvasNodeRenderBoundary nodeId={props.data.node.id} selected={props.selected}><BasicCanvasNodeComponent {...props} /></CanvasNodeRenderBoundary>;
  },
  (previous, next) => previous.data === next.data && previous.selected === next.selected,
);

/** Construct a persistent canvas card for an already-created project artifact. */
export function createCanvasArtifactNode(args: {
  id: string;
  x: number;
  y: number;
  artifact: ArtifactDescriptor;
  width?: number;
  height?: number;
}): CanvasBasicNode {
  return {
    id: args.id,
    ...canvasArtifactProjection(args.artifact),
    x: args.x,
    y: args.y,
    width: args.width ?? (args.artifact.renderer === 'html' ? HTML_PAGE_CARD_SIZE.width : 420),
    height: args.height ?? (args.artifact.renderer === 'html' ? HTML_PAGE_CARD_SIZE.height : 320),
    title: args.artifact.title,
    artifact: args.artifact,
    ...(args.artifact.resource.kind === 'project-file'
      ? {
          projectFilePath: args.artifact.resource.path,
          sourceMime: args.artifact.resource.mimeType,
        }
      : {}),
  };
}

export function buildBasicCanvasNode(args: {
  storyboardLibrary?: BasicCanvasNodeData['storyboardLibrary'];
  onSelect?: BasicCanvasNodeData['onSelect'];
  onFocus?: BasicCanvasNodeData['onFocus'];
  node: CanvasBasicNode;
  selected?: boolean;
  generationProgress?: BasicCanvasNodeData['generationProgress'];
  onPatch: BasicCanvasNodeData['onPatch'];
  onRemoveReference?: BasicCanvasNodeData['onRemoveReference'];
  onRemove: BasicCanvasNodeData['onRemove'];
  onDuplicate: BasicCanvasNodeData['onDuplicate'];
  onPickImage: BasicCanvasNodeData['onPickImage'];
  canvasMediaResources?: CanvasReferenceResource[];
  onAddConnectedNode: BasicCanvasNodeData['onAddConnectedNode'];
  onAddUpstreamTextNode?: BasicCanvasNodeData['onAddUpstreamTextNode'];
}): Node<BasicCanvasNodeData> {
  const isHtmlPage = args.node.kind === 'page';
  const isStoryboard = args.node.kind === 'storyboard';
  const isVideo = args.node.kind === 'video';
  const storyboardHeight = isStoryboard && args.node.storyboard
    ? args.node.height || storyboardEditorHeight(args.node.storyboard.shots.length)
    : undefined;
  const videoFrame = isVideo ? resolveVideoFrameSize(args.node.width, args.node.height, args.node.videoAspect) : null;
  return {
    id: args.node.id,
    type: 'basicCanvas',
    position: { x: args.node.x, y: args.node.y },
    width: args.node.kind === 'text' && (args.node.width === 350 || args.node.width === 440)
      ? TEXT_CARD_DEFAULT_WIDTH
      : isHtmlPage ? Math.max(args.node.width || 0, HTML_PAGE_CARD_SIZE.width) : isStoryboard ? (args.node.storyboard ? ((args.node.width || 0) < STORYBOARD_EDITOR_MIN_WIDTH ? STORYBOARD_EDITOR_DEFAULT_WIDTH : args.node.width) : ((args.node.width === 480 || args.node.width === 680) ? STORYBOARD_CARD_DEFAULT_WIDTH : Math.max(args.node.width || 0, STORYBOARD_CARD_DEFAULT_WIDTH))) : isVideo ? videoFrame!.width : args.node.width,
    height: args.node.kind === 'text' && (args.node.height === 360 || args.node.height === 500 || args.node.height === 620)
      ? TEXT_CARD_DEFAULT_HEIGHT
      : isHtmlPage ? Math.max(args.node.height || 0, HTML_PAGE_CARD_SIZE.height) : isStoryboard ? (storyboardHeight ?? ((args.node.height === 420 || args.node.height === 560) ? STORYBOARD_CARD_DEFAULT_HEIGHT : Math.max(args.node.height || 0, 420))) : isVideo ? videoFrame!.height : args.node.height,
    ...(args.selected === undefined ? {} : { selected: args.selected }),
    draggable: true,
    dragHandle: '.node-drag-surface',
    data: {
      storyboardLibrary: args.storyboardLibrary,
      onSelect: args.onSelect,
      onFocus: args.onFocus,
      node: args.node,
      ...(args.generationProgress ? { generationProgress: args.generationProgress } : {}),
      onPatch: args.onPatch,
      onRemoveReference: args.onRemoveReference,
      onRemove: args.onRemove,
      onDuplicate: args.onDuplicate,
      onPickImage: args.onPickImage,
      canvasMediaResources: args.canvasMediaResources,
      onAddConnectedNode: args.onAddConnectedNode,
      onAddUpstreamTextNode: args.onAddUpstreamTextNode,
    },
  };
}
