import type { ProjectFile } from './files.js';

export type ClipEditorMediaKind = 'image' | 'video' | 'audio';

export interface ClipEditorVisual {
  /** Frame-relative percentages; rotation is around the box center. */
  x?: number; y?: number; width?: number; height?: number; rotation?: number;
  opacity?: number;
  crop?: { top: number; right: number; bottom: number; left: number };
  animation?: 'none' | 'fade' | 'slide';
  animationDuration?: number;
  /** Non-destructive adjustments shared by browser preview and native export. */
  adjustments?: {
    brightness?: number;
    contrast?: number;
    saturation?: number;
    blur?: number;
  };
}

export interface ClipEditorMarker {
  id: string;
  time: number;
  label: string;
}

export interface ClipEditorTrackState {
  kind: 'visual' | 'audio';
  index: number;
  locked?: boolean;
  muted?: boolean;
  solo?: boolean;
}

export interface ClipEditorTimelineClip {
  id: string;
  kind: ClipEditorMediaKind;
  name: string;
  path: string;
  mimeType: string;
  start: number;
  sourceIn: number;
  duration: number;
  sourceDuration?: number;
  volume?: number;
  muted?: boolean;
  fit?: 'contain' | 'cover';
  track?: number;
  visual?: ClipEditorVisual;
  fadeIn?: number;
  fadeOut?: number;
  /** Source playback multiplier. Timeline duration remains composition time. */
  playbackRate?: number;
  /** Repeat source media when the visible timeline span exceeds the source. */
  loop?: boolean;
}

export interface ClipEditorTimeline {
  version: 1;
  clips: ClipEditorTimelineClip[];
  playhead: number;
  selectedClipId?: string;
  width?: number;
  height?: number;
  markers?: ClipEditorMarker[];
  trackStates?: ClipEditorTrackState[];
}

export type ClipEditorExportFormat = 'mp4' | 'png' | 'webp';
export type ClipEditorExportQuality = 'draft' | 'standard' | 'high';

export interface ClipEditorExportOptions {
  format: ClipEditorExportFormat;
  quality: ClipEditorExportQuality;
  fps: 24 | 30 | 60;
  /** Composition time used by still-image exports. */
  stillTime?: number;
}

export interface ClipEditorExportRequest {
  timeline: ClipEditorTimeline;
  title?: string;
  options?: ClipEditorExportOptions;
}

export interface ClipEditorExportResponse {
  ok: true;
  file: ProjectFile;
  duration: number;
}

export interface ClipEditorExportJobResponse {
  ok: true;
  jobId: string;
}

export interface ClipEditorExportJobStatusResponse {
  ok: true;
  jobId: string;
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  progress: number;
  file?: ProjectFile;
  duration?: number;
  error?: string;
}
