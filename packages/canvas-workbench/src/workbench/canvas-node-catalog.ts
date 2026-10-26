import { canvasNodeCopy } from '../locales/node-catalog';
export type CanvasNodeCreationKind = 'image' | 'text' | 'sketch' | 'browser' | 'storyboard' | 'video' | 'page' | 'presentation';

/** One-shot host request to create a real node through the canvas state path.
 * `position` is a flow-space coordinate — drops place the card where it
 * landed, launcher-created cards keep automatic viewport placement. */
export type CanvasNodeCreationRequest = {
  nonce: string;
  kind: CanvasNodeCreationKind;
  position?: { x: number; y: number };
  /** Optional title override (e.g. a dropped file's name); default is the
   * locale catalogue title. The doc synchronizer names bound docs after it. */
  title?: string;
};

export type CanvasNodeCreationOption = {
  kind: CanvasNodeCreationKind;
  label: string;
  description: string;
  icon: 'type' | 'edit' | 'globe' | 'gallery-horizontal' | 'artifact-page' | 'artifact-presentation' | 'artifact-image' | 'artifact-video' | 'scissors';
  disabled?: boolean;
  badge?: string;
};

/**
 * The single catalogue behind every canvas "add node" entry.
 *
 * The dock and the source-handle menu intentionally consume the same records:
 * adding a node type in one place must make it discoverable everywhere.
 *
 * Menu order is by what you are placing, not by when the feature shipped:
 * assets you make (image, text, sketch), the motion pipeline
 * (storyboard, then video, then the timeline), then formatted deliverables.
 */
// All menu glyphs use Lucide's 24px grid; legacy 16px paths make equal strokes heavier.
const NODE_ICONS = {
  image: 'artifact-image',
  text: 'type',
  sketch: 'edit',
  browser: 'globe',
  storyboard: 'gallery-horizontal',
  video: 'artifact-video',
  page: 'artifact-page',
  presentation: 'artifact-presentation',
} as const satisfies Record<CanvasNodeCreationKind, CanvasNodeCreationOption['icon']>;

export const CANVAS_NODE_MENU_GROUPS: readonly (readonly CanvasNodeCreationKind[])[] = [
  ['image', 'text', 'sketch'],
  ['storyboard', 'video'],
  ['page', 'presentation'],
];

export function canvasNodeCreationOptions(locale?: string | null): readonly CanvasNodeCreationOption[] {
  const copy = canvasNodeCopy(locale);
  return CANVAS_NODE_MENU_GROUPS.flat().map((kind) => ({
    kind,
    label: copy[kind].label,
    description: copy[kind].description,
    icon: NODE_ICONS[kind],
  }));
}

/** Historical Chinese catalogue. Live menus use canvasNodeCreationOptions(locale). */
export const CANVAS_NODE_CREATION_OPTIONS: readonly CanvasNodeCreationOption[] = canvasNodeCreationOptions('zh-CN');

export function canvasNodeDefaultTitle(
  locale: string | null | undefined,
  kind: CanvasNodeCreationKind | 'artifact',
  artifactFormat?: 'html' | 'presentation',
): string {
  const resolved = (kind === 'page' || kind === 'artifact') && artifactFormat === 'presentation'
    ? 'presentation'
    : kind === 'artifact' ? 'page' : kind;
  return canvasNodeCopy(locale)[resolved].defaultTitle;
}

const CANVAS_NODE_DOWNSTREAM_EXCLUSIONS: Partial<Record<CanvasNodeCreationKind, readonly CanvasNodeCreationKind[]>> = {
  storyboard: ['storyboard'],
};

/** Node kinds that must not be created or connected downstream of a source kind. */
export function excludedCanvasDownstreamKinds(sourceKind: CanvasNodeCreationKind) {
  return CANVAS_NODE_DOWNSTREAM_EXCLUSIONS[sourceKind] || [];
}

/** Shared guard for source menus and direct React Flow connections. */
export function isCanvasNodeConnectionAllowed(
  sourceKind: string | undefined,
  targetKind: string | undefined,
) {
  if (!sourceKind || !targetKind) return true;
  return !excludedCanvasDownstreamKinds(sourceKind as CanvasNodeCreationKind)
    .includes(targetKind as CanvasNodeCreationKind);
}
