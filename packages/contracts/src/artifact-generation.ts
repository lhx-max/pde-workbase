/** Generation settings shared by production canvas cards and workflow deliverables. */
export const IMAGE_GENERATION_RATIOS = ['1:1', '3:4', '4:3', '9:16', '16:9'] as const;
export const IMAGE_GENERATION_RESOLUTIONS = ['2K', '4K'] as const;
export const IMAGE_GENERATION_COUNTS = [1, 2, 3, 4] as const;
export const PRESENTATION_LENGTH_OPTIONS = [
  { value: 'concise', label: 'Brief', detail: 'About 5–7 pages, highlight the core takeaway', slides: 6 },
  { value: 'standard', label: 'Medium', detail: 'About 8–12 pages, cover the topic fully', slides: 10 },
  { value: 'detailed', label: 'Detailed', detail: 'About 13–18 pages, add cases and data', slides: 15 },
] as const;
export const TEXT_LENGTH_OPTIONS = [
  { value: 'auto', label: 'Length', detail: 'Fit the length to the content' },
  { value: 'short', label: 'Short', detail: 'About 300 words' },
  { value: 'medium', label: 'Medium', detail: 'About 800 words' },
  { value: 'long', label: 'Long', detail: 'About 1,500 words' },
] as const;
export type ArtifactTemplateOptions = {
  template?: string; templateTitle?: string; templateDescription?: string;
  templateReferencePath?: string; templatePrompt?: string;
};
export type ArtifactReference = { id?: string; name: string; url: string; prompt?: string };
export type ArtifactImageOptions = {
  model?: string; ratio?: typeof IMAGE_GENERATION_RATIOS[number];
  resolution?: typeof IMAGE_GENERATION_RESOLUTIONS[number]; count?: number;
  references?: ArtifactReference[];
};
export type ArtifactPresentationOptions = ArtifactTemplateOptions & {
  length?: typeof PRESENTATION_LENGTH_OPTIONS[number]['value'];
  /** Preserve exact page counts in existing workflows. */
  pages?: number;
};
export type ArtifactPageOptions = ArtifactTemplateOptions & { designSystemId?: string; designSystemTitle?: string };
export type ArtifactTextOptions = { length?: typeof TEXT_LENGTH_OPTIONS[number]['value']; templateId?: string; templateTitle?: string; templatePrompt?: string };
export type VideoCameraMoveId = 'orbit_left' | 'orbit_right' | 'push_in' | 'pull_out' | 'crane_up' | 'crane_down' | 'track_left' | 'track_right' | 'arc_left' | 'arc_right' | 'zoom_in' | 'zoom_out' | 'dolly_zoom';
export type VideoCameraSpeed = 'slow' | 'medium' | 'fast';
export type VideoCameraShot = 'wide' | 'medium' | 'close';
export type VideoCameraMove = { move: VideoCameraMoveId; speed: VideoCameraSpeed; shot: VideoCameraShot };
export type ArtifactVideoOptions = {
  model?: string; mode?: 't2v' | 'i2v' | 'firstlast'; ratio?: string; duration?: number;
  resolution?: string; cameraMove?: VideoCameraMove; firstFrameUrl?: string; lastFrameUrl?: string;
};
export type ArtifactGenerationConfig = {
  image?: ArtifactImageOptions; video?: ArtifactVideoOptions; presentation?: ArtifactPresentationOptions;
  page?: ArtifactPageOptions; text?: ArtifactTextOptions;
};
export function nativeImageModelId(model: string): string {
  return ({ gpt2: 'kuaishou/gpt-image-2', gemini: 'kuaishou/gemini-3.1-flash-image', 'codex-gpt2': 'codex-gpt-image-2' } as Record<string, string>)[model] ?? model;
}
/** Canvas cards persist the visual-model aliases used by TaskDraft. */
export function canvasImageModelId(model: string): string {
  return ({ 'kuaishou/gpt-image-2': 'gpt2', 'kuaishou/gemini-3.1-flash-image': 'gemini', 'codex-gpt-image-2': 'codex-gpt2' } as Record<string, string>)[model] ?? model;
}
export function videoGenerationLengths(model: string, catalogLengths?: readonly number[]): number[] {
  return model === 'wanqing-video' || !catalogLengths?.some(value => value >= 4)
    ? [4, 5] : catalogLengths.filter(value => value >= 4);
}
export const VIDEO_GENERATION_ASPECTS = ['16:9', '9:16', '1:1'] as const;

export const VIDEO_GENERATION_RESOLUTIONS = ['720p', '1080p'] as const;
