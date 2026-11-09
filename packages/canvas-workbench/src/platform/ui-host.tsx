'use client';

import React from 'react';
import type { ExecutionSnapshot } from '@bezier/contracts';
import type { CanvasImageEditorTarget } from '@bezier/contracts';
import type { ImageReferencePickerProps, ArtifactTemplatePickerProps, CanvasDesignSystemPickerProps } from '../workbench/ImageReferenceResourcePicker';

/** Product data and ownership stay in the host; the canvas only describes selection. */
export type CanvasAssetPickerProps =
  | ({ kind: 'media' } & ImageReferencePickerProps)
  | ({ kind: 'artifact' } & ArtifactTemplatePickerProps)
  | ({ kind: 'design-system' } & CanvasDesignSystemPickerProps);
export type CanvasAssetPickerRenderer = (props: CanvasAssetPickerProps) => React.ReactNode;

export interface CanvasPopoverRenderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactElement;
  children: React.ReactNode;
  contentClassName: string;
  ariaLabel: string;
  wrapDomainMenu?: boolean;
  role?: 'dialog' | 'listbox';
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  /** Keep node-local overlays inside the same transformed React Flow subtree. */
  portalContainer?: HTMLElement | null;
}

export type CanvasPopoverRenderer = (
  props: CanvasPopoverRenderProps,
) => React.ReactNode;

export interface CanvasHoverCardRenderProps {
  trigger: React.ReactElement;
  children: React.ReactNode;
  contentClassName?: string;
  ariaLabel: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

export type CanvasHoverCardRenderer = (
  props: CanvasHoverCardRenderProps,
) => React.ReactNode;

export interface CanvasDialogRenderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className: string;
  ariaLabelledBy?: string;
  ariaLabel?: string;
  /** Resource pickers use the shared large shell; domain preserves its own geometry. */
  surface?: 'resource' | 'domain';
  /** Host-owned content uses public primitives, without legacy canvas element resets. */
  canvasStyles?: boolean;
  /** Visual scrim only; transparent dialogs keep the same modal/focus behavior. */
  backdrop?: 'dimmed' | 'transparent';
}

export type CanvasDialogRenderer = (
  props: CanvasDialogRenderProps,
) => React.ReactNode;

export type CanvasMenuItem = {
  id: string;
  content?: React.ReactNode;
  disabled?: boolean;
  onSelect?: () => void;
  value?: string;
  kind?: 'item' | 'separator';
  className?: string;
};

export interface CanvasMenuRenderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactElement;
  items: readonly CanvasMenuItem[];
  contentClassName?: string;
  ariaLabel: string;
  label?: React.ReactNode;
  /** Node-local menus use the live canvas zoom; toolbar menus omit this. */
  scale?: number;
  selectedValue?: string;
  onSelectedValueChange?: (value: string) => void;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
}

export type CanvasMenuRenderer = (
  props: CanvasMenuRenderProps,
) => React.ReactNode;

export type CanvasTabsItem = {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
};

export interface CanvasTabsRenderProps {
  value: string;
  onValueChange: (value: string) => void;
  items: readonly CanvasTabsItem[];
  ariaLabel: string;
  className?: string;
}

export type CanvasTabsRenderer = (
  props: CanvasTabsRenderProps,
) => React.ReactNode;

export type CanvasResourceGridItem = {
  id: string;
  name: string;
  meta: string;
  preview?: string;
  kind?: 'image' | 'video' | 'audio';
  checked: boolean;
  templatePreview?: {
    type: 'deck' | 'prototype';
    previewSrc?: string;
    videoUrl?: string;
  };
};

export interface CanvasResourceGridRenderProps {
  items: readonly CanvasResourceGridItem[];
  onToggle: (id: string) => void;
  emptyState: React.ReactNode;
}

export type CanvasResourceGridRenderer = (
  props: CanvasResourceGridRenderProps,
) => React.ReactNode;

export interface CanvasUiHost {
  /** Registered image App detail navigation; no image storage is owned by this hook. */
  openImageApp?: (target: CanvasImageEditorTarget) => Promise<void>;
  renderWorkflowQuestion?: (snapshot: import("@bezier/contracts").WorkflowCanvasRun) => React.ReactNode;
  /** Read at submission only. Never store this result in canvas or workflow state. */
  getExecutionSnapshot?: () => ExecutionSnapshot;
  openExecutionSettings?: () => void;
  /** Request-only AI capability; host selects current API/CLI settings. */
  expandWorkflowDescription?: (input: { workflowName: string; description: string }) => Promise<string>;
  renderAssetPicker?: CanvasAssetPickerRenderer;
  /** Select a library resource as an incoming reference. Returns a selection cancellation callback. */
  selectTextReference?: (nodeId: string) => void | (() => void);
  /** Same-document preview with host compositor snapshots and bounded loading. */
  renderArtifactPreview?: (props: { src: string; title: string; presentation: boolean; detail: boolean; nearby: boolean; onFrameReady: (frame: HTMLIFrameElement) => void }) => React.ReactNode;
  /** Inert overview thumbnail; must never execute artifact scripts or fall back to a live iframe. */
  renderArtifactThumbnail?: (props: { src: string; title: string; presentation: boolean }) => React.ReactNode;
  cacheArtifactThumbnail?: (src: string, frame: HTMLIFrameElement) => void;
  /** A file-backed sketch preview. The host owns its existing editor and persistence. */
  renderSketch?: (props: { path: string; nodeId?: string; selected: boolean; pending: boolean; onCreated: () => Promise<void> }) => React.ReactNode;
  duplicateSketch?: (source: string, destination: string, pending: boolean) => Promise<void>;
  /** Host-owned library export; the canvas does not own a product asset database. */
  saveResource?: (input: { name: string; filename: string; sourcePath?: string; nodeId?: string; mime: string; text?: string; url?: string; kind?: 'text' | 'script' | 'slides' | 'webpage' | 'motion' }) => Promise<void>;
  downloadResource?: (input: { url: string; fileName: string; nodeId?: string }) => Promise<void>;
  /** Product-owned image template catalogue capability. */
  imageTemplatesEnabled?: boolean;
  renderTextEditor?: (props: { markdown: string; onChange: (value: string) => void; onOpenDetail: () => void; renderToolbar: (toolbar: React.ReactNode) => React.ReactNode }) => React.ReactNode;
  /** Whether a management-side agent executor is reachable. When falsy,
   * card AI composers must hide entirely — never show a prompt box that
   * can accept input but has nobody to execute it. */
  agentTasksAvailable?: boolean;
  renderPopover: CanvasPopoverRenderer;
  renderHoverCard: CanvasHoverCardRenderer;
  renderDialog: CanvasDialogRenderer;
  renderMenu: CanvasMenuRenderer;
  renderTabs: CanvasTabsRenderer;
  /** Category filters are pressed chips, not content tabs. */
  renderTemplateCategories?: CanvasTabsRenderer;
  /** Host-owned card renderer shared with the Assets template catalogue. */
  renderTemplateGrid?: CanvasResourceGridRenderer;
  /** Keep visible category names aligned with the Assets catalogue. */
  formatTemplateCategory?: (category: string) => string;
}

const CanvasUiHostContext = React.createContext<CanvasUiHost | null>(null);
const CanvasNodeOverlayPortalContext = React.createContext<HTMLElement | null>(null);

export function CanvasNodeOverlayPortalProvider({
  children,
  container,
}: {
  children: React.ReactNode;
  container: HTMLElement | null;
}) {
  return (
    <CanvasNodeOverlayPortalContext.Provider value={container}>
      {children}
    </CanvasNodeOverlayPortalContext.Provider>
  );
}

export function useCanvasNodeOverlayPortalContainer(): HTMLElement | null {
  return React.useContext(CanvasNodeOverlayPortalContext);
}

export function CanvasUiHostProvider({
  value,
  children,
}: {
  value: CanvasUiHost;
  children: React.ReactNode;
}) {
  return (
    <CanvasUiHostContext.Provider value={value}>
      {children}
    </CanvasUiHostContext.Provider>
  );
}

export function useCanvasUiHost(): CanvasUiHost | null {
  return React.useContext(CanvasUiHostContext);
}

export function CanvasHostedDialog({
  open,
  onOpenChange,
  children,
  className,
  ariaLabelledBy,
  ariaLabel,
  surface = 'domain',
  canvasStyles,
  backdrop,
}: CanvasDialogRenderProps) {
  const host = useCanvasUiHost();
  const renderer = requireCanvasDialogRenderer(host);
  return renderer({
    open,
    onOpenChange,
    children,
    className,
    ariaLabelledBy,
    ariaLabel,
    surface,
    canvasStyles,
    backdrop,
  });
}

export function requireCanvasPopoverRenderer(
  host: CanvasUiHost | null,
  renderer?: CanvasPopoverRenderer,
): CanvasPopoverRenderer {
  const resolved = renderer ?? host?.renderPopover;
  if (!resolved) {
    throw new Error('Canvas popover renderer is not configured by the host.');
  }
  return resolved;
}

export function requireCanvasHoverCardRenderer(
  host: CanvasUiHost | null,
  renderer?: CanvasHoverCardRenderer,
): CanvasHoverCardRenderer {
  const resolved = renderer ?? host?.renderHoverCard;
  if (!resolved) {
    throw new Error('Canvas hover card renderer is not configured by the host.');
  }
  return resolved;
}

export function requireCanvasDialogRenderer(
  host: CanvasUiHost | null,
  renderer?: CanvasDialogRenderer,
): CanvasDialogRenderer {
  const resolved = renderer ?? host?.renderDialog;
  if (!resolved) {
    throw new Error('Canvas dialog renderer is not configured by the host.');
  }
  return resolved;
}

export function requireCanvasMenuRenderer(
  host: CanvasUiHost | null,
  renderer?: CanvasMenuRenderer,
): CanvasMenuRenderer {
  const resolved = renderer ?? host?.renderMenu;
  if (!resolved) {
    throw new Error('Canvas menu renderer is not configured by the host.');
  }
  return resolved;
}

export function requireCanvasTabsRenderer(
  host: CanvasUiHost | null,
  renderer?: CanvasTabsRenderer,
): CanvasTabsRenderer {
  const resolved = renderer ?? host?.renderTabs;
  if (!resolved) {
    throw new Error('Canvas tabs renderer is not configured by the host.');
  }
  return resolved;
}
