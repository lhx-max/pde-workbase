/**
 * DA 与 OEM 产品共享的画布对外出口。
 *
 * 宿主只应该消费这里导出的东西——包内的 `Workbench.tsx`、`workbench/*`
 * 是内部实现，不作为公共 API。业务模块通过宿主配置启用，共用画布标准。
 */

export { CanvasWorkbenchSurface, default } from './CanvasWorkbenchSurface';
export { createCanvasTaskSubmitter } from './platform/task-client';
export { awaitCanvasGenerationBinding, flushCanvasForProject } from './platform/canvas-persistence';
export { readCanvasSelection } from './platform/object-bridge';
export { overrideCanvasTextDeliveryInstruction } from './platform/canvas-text-delivery-instruction';
export type { CanvasTaskClientOptions } from './platform/task-client';
export type { CanvasHostContext, CanvasTransport } from './platform/api-base';
export { localizeDaemonMessage } from './locales/daemon-messages';
export { CanvasKindAvailability, useCanvasKindAvailability } from './platform/kind-availability';
export { focusCanvasObject, prepareCanvasObject, failCanvasObject, readCanvasObject, continueCanvasObject, registerCanvasNavigator, revealCanvasObject } from './platform/object-bridge';
export type { CanvasObjectReference } from './platform/object-bridge';
export { readCanvasObjectPreview, subscribeCanvasObjectPreviews } from './platform/object-bridge';
export type { CanvasObjectPreview } from './platform/object-bridge';
export type {
  CanvasNodeCreationKind,
  CanvasNodeCreationRequest,
} from './workbench/canvas-node-catalog';
export type {
  CanvasWorkbenchSurfaceProps,
  CanvasWorkflowPendingRequest,
} from './CanvasWorkbenchSurface';

export type {
  AgentTaskDisplay,
  AgentTaskSubmitter,
  CanvasArtifactGenerationResult,
  CanvasTextGenerationResult,
  HostConversationMessage,
} from './platform/agent-bridge';
export type {
  ArtifactOpener,
  TextDocumentChange,
  TextDocumentOpenRequest,
  TextDocumentOpenResult,
  TextDocumentOpener,
} from './platform/artifact-bridge';
export type { ViewName } from './app/router';
export type {
  CanvasDialogRenderProps,
  CanvasDialogRenderer,
  CanvasHoverCardRenderProps,
  CanvasHoverCardRenderer,
  CanvasMenuItem,
  CanvasMenuRenderProps,
  CanvasMenuRenderer,
  CanvasPopoverRenderProps,
  CanvasPopoverRenderer,
  CanvasTabsItem,
  CanvasTabsRenderProps,
  CanvasTabsRenderer,
  CanvasResourceGridItem,
  CanvasResourceGridRenderProps,
  CanvasResourceGridRenderer,
  CanvasUiHost,
  CanvasAssetPickerProps,
  CanvasAssetPickerRenderer,
} from './platform/ui-host';
export { applyCanvasTextGenerationResults } from './workbench/canvas-text-generation';
export { CanvasSelectionItem } from './workbench/CanvasSelectionItem';
export type {
  CanvasSelectionItemProps,
  CanvasSelectionSemantics,
} from './workbench/CanvasSelectionItem';
export {
  createCanvasArtifactNode,
} from './workbench/BasicCanvasNode';
export {
  isCanvasArtifactFile,
  projectFileArtifactDescriptor,
} from './workbench/canvas-artifact';
export type { CanvasArtifactLaunchRequest } from './workbench/canvas-artifact';
export type { CanvasBasicNode } from './workbench/BasicCanvasNode';
export {
  ImageReferenceResourcePicker,
  CanvasDesignSystemResourcePicker,
  PresentationTemplateResourcePicker,
  WebpageTemplateResourcePicker,
  downloadReferenceAssets,
} from './workbench/ImageReferenceResourcePicker';
export type {
  CanvasReferenceResource,
  CanvasReferenceResourceKind,
  CanvasDesignSystemReference,
  PresentationTemplateReference,
  WebpageTemplateReference,
  ReferenceImageAsset,
  PositiveOperationReferenceAsset,
  ReferenceUploadFiles,
  ResourceDialogRenderProps,
  ResourceDialogRenderer,
  ResourceDialogTitleRenderer,
  ImageReferenceResourceGridItem,
  ImageReferenceResourceGridRenderProps,
  ImageReferenceResourceGridRenderer,
} from './workbench/ImageReferenceResourcePicker';
export { mergeReferenceImagePrompt, REFERENCE_IMAGE_PROMPT } from './workbench/reference-image-prompt';
export { ImageGenerationOptionControls } from './workbench/ImageGenerationOptionControls';
export type {
  ImageGenerationModelOption,
  ImageGenerationPopoverRenderProps,
  ImageGenerationPopoverRenderer,
} from './workbench/ImageGenerationOptionControls';
export {
  CANVAS_IMAGE_GENERATION_MODELS,
  CANVAS_IMAGE_GENERATION_RATIOS,
  normalizeCanvasImageGenerationIntent,
} from './workbench/image-generation-launch';
export {
  PRESENTATION_LENGTH_OPTIONS,
  createPresentationGenerationTask,
  normalizeCanvasPresentationGenerationIntent,
} from './workbench/presentation-generation-launch';
export {
  createWebpageGenerationTask,
  normalizeCanvasWebpageGenerationIntent,
} from './workbench/webpage-generation-launch';
export type { CanvasWebpageGenerationIntent } from './workbench/webpage-generation-launch';
export type {
  CanvasPresentationGenerationIntent,
  CanvasPresentationGenerationLaunchRequest,
  CanvasPresentationLength,
} from './workbench/presentation-generation-launch';
export type {
  CanvasImageGenerationIntent,
  CanvasImageGenerationLaunchRequest,
  CanvasImageGenerationModel,
  CanvasImageGenerationRatio,
  CanvasImageGenerationReference,
  CanvasImageGenerationResolution,
} from './workbench/image-generation-launch';
export {
  POSITIVE_OPERATION_REFERENCE_PROMPT,
  mergeOrdinaryGlowReferencePrompt,
  mergePositiveOperationReferencePrompt,
} from './workbench/positive-operation-reference-prompt';
export { CanvasUiHostProvider } from './platform/ui-host';
export { useCanvasMediaCatalog, useCanvasImageModels } from './platform/media-catalog';
export { PageGenerationOptionControls } from './workbench/PageGenerationOptionControls';
export { TextGenerationOptionControls } from './workbench/TextGenerationOptionControls';
export { VideoGenerationOptionControls } from './workbench/VideoGenerationOptionControls';export type { CardRenderProps, CardRenderer, CardPack, CardPackCard } from './workbench/card-registry';
export { registerCardPack, cardRendererFor } from './workbench/card-registry';
import './packs';
