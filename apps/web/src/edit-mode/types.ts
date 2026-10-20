export type ManualEditKind = 'text' | 'link' | 'image' | 'container' | 'token';

export interface ManualEditRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ManualEditComputedSummary {
  display: string;
  position: string;
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  color: string;
  backgroundColor: string;
  borderColor: string;
  borderRadius: string;
  padding: string;
  margin: string;
}

export interface ManualEditMeasurement {
  label: string;
  value: number;
  orientation: 'horizontal' | 'vertical';
  from: ManualEditRect;
  to: ManualEditRect;
}

export interface ManualEditAlignmentGuide {
  orientation: 'horizontal' | 'vertical';
  position: number;
  label: string;
}

export interface ManualEditFields {
  text?: string;
  href?: string;
  src?: string;
  alt?: string;
}

export interface ManualEditStyles {
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  color: string;
  textAlign: string;
  lineHeight: string;
  letterSpacing: string;
  width: string;
  height: string;
  minHeight: string;
  gap: string;
  flexDirection: string;
  justifyContent: string;
  alignItems: string;
  backgroundColor: string;
  opacity: string;
  padding: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  margin: string;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  border: string;
  borderTopWidth: string;
  borderRightWidth: string;
  borderBottomWidth: string;
  borderLeftWidth: string;
  borderStyle: string;
  borderColor: string;
  borderRadius: string;
  /* Free drag-to-reposition writes a translate() here (on top of the element's
     own layout position), persisted like any other inline style. `display` is
     bumped to inline-block for inline elements so the translate takes effect. */
  transform: string;
  display: string;
}

export interface ManualEditTarget {
  id: string;
  kind: ManualEditKind;
  label: string;
  tagName: string;
  className: string;
  text: string;
  rect: ManualEditRect;
  fields: ManualEditFields;
  attributes: Record<string, string>;
  styles: ManualEditStyles;
  computedSummary?: ManualEditComputedSummary;
  parentRect?: ManualEditRect;
  siblingRects?: ManualEditRect[];
  measurements?: ManualEditMeasurement[];
  alignmentGuides?: ManualEditAlignmentGuide[];
  isLayoutContainer: boolean;
  isHidden?: boolean;
  outerHtml: string;
}

export type ManualEditPatch =
  | { id: string; kind: 'set-text'; value: string }
  | { id: string; kind: 'set-link'; text: string; href: string }
  | { id: string; kind: 'set-image'; src: string; alt: string }
  | { id: string; kind: 'remove-element' }
  | { kind: 'set-token'; token: string; value: string }
  | { id: string; kind: 'set-style'; styles: Partial<ManualEditStyles> }
  | { id: string; kind: 'set-attributes'; attributes: Record<string, string> }
  | { id: string; kind: 'set-outer-html'; html: string }
  | { kind: 'set-full-source'; source: string };

export interface ManualEditHistoryEntry {
  id: string;
  label: string;
  patch: ManualEditPatch;
  beforeSource: string;
  afterSource: string;
  createdAt: number;
}

export interface ManualEditTargetMessage {
  type: 'bezier-edit-targets';
  targets: ManualEditTarget[];
}

export interface ManualEditSelectMessage {
  type: 'bezier-edit-select';
  target: ManualEditTarget;
}

export interface ManualEditHoverMessage {
  type: 'bezier-edit-hover';
  target: ManualEditTarget;
}

export interface ManualEditInspectHoverMessage {
  type: 'bezier-edit-inspect-hover';
  target: ManualEditTarget;
}

export interface ManualEditInspectSelectMessage {
  type: 'bezier-edit-inspect-select';
  target: ManualEditTarget;
}

export interface ManualEditBackgroundMessage {
  type: 'bezier-edit-background';
}

export interface ManualEditClearSelectionMessage {
  type: 'bezier-edit-clear-selection';
}

export interface ManualEditMeasurePinMessage {
  type: 'bezier-edit-measure-pin';
  anchorId: string | null;
  comparisonId: string | null;
  active: boolean;
}

/** The iframe tells its host when inspection is actively drawing dimensions. */
export interface ManualEditMeasureModeMessage {
  type: 'bezier-edit-measure-mode';
  active: boolean;
}

export interface ManualEditPreviewAppliedMessage {
  type: 'bezier-edit-preview-style-applied';
  id: string;
  version: number;
  ok: boolean;
  error?: string;
}

export interface ManualEditTextCommitMessage {
  type: 'bezier-edit-text-commit';
  id: string;
  value: string;
}

export interface ManualEditTextSessionMessage {
  type: 'bezier-edit-text-session';
  id: string;
  active: boolean;
  changed?: boolean;
  committed?: boolean;
}

/** Free drag-to-reposition finished: the element's new translate() value, to
 *  be committed as a pending style so the panel's Save persists it. */
export interface ManualEditDragCommitMessage {
  type: 'bezier-edit-drag-commit';
  id: string;
  transform: string;
  /** Set when an inline element was bumped to inline-block so the translate
   *  applies; persisted alongside the transform. */
  display?: string;
}

export type ManualEditBridgeMessage =
  | ManualEditTargetMessage
  | ManualEditSelectMessage
  | ManualEditHoverMessage
  | ManualEditInspectHoverMessage
  | ManualEditInspectSelectMessage
  | ManualEditBackgroundMessage
  | ManualEditClearSelectionMessage
  | ManualEditMeasurePinMessage
  | ManualEditMeasureModeMessage
  | ManualEditPreviewAppliedMessage
  | ManualEditTextCommitMessage
  | ManualEditTextSessionMessage
  | ManualEditDragCommitMessage;

export const MANUAL_EDIT_STYLE_PROPS: readonly (keyof ManualEditStyles)[] = [
  'fontFamily', 'fontSize', 'fontWeight', 'color', 'textAlign', 'lineHeight', 'letterSpacing',
  'width', 'height', 'minHeight',
  'gap', 'flexDirection', 'justifyContent', 'alignItems',
  'backgroundColor', 'opacity',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'border', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'borderStyle', 'borderColor', 'borderRadius',
  'transform', 'display',
];

export function emptyManualEditStyles(): ManualEditStyles {
  return MANUAL_EDIT_STYLE_PROPS.reduce<ManualEditStyles>((acc, key) => {
    acc[key] = '';
    return acc;
  }, {} as ManualEditStyles);
}
