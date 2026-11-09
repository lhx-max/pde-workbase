// Upstream Bezier/Loom 319e5eee; Apache-2.0; path: components/PreviewCaptureEvents.ts
import type { PreviewVisualMarkKind } from '../../types';

// Shared screenshot-to-composer contract. Historical mark metadata remains
// readable for existing attachments; the drawing editor itself is retired.
export const ANNOTATION_EVENT = 'bezier:annotation';
export interface AnnotationEventDetail {
  file: File | null;
  note: string;
  action: 'draft' | 'queue' | 'send';
  filePath?: string;
  markKind?: PreviewVisualMarkKind;
  bounds?: { x: number; y: number; width: number; height: number };
  target?: {
    filePath?: string;
    elementId?: string;
    selector?: string;
    label?: string;
    text?: string;
    position: { x: number; y: number; width: number; height: number };
    htmlHint?: string;
  } | null;
  extraFiles?: File[];
  ack?: (result: { ok: boolean; message?: string }) => void;
}
