import type { PersonalAsset } from '@bezier/contracts';

/** Original catalogue view models without installed-plugin/account/execution stores. */
export interface MediaPreviewSpec {
  kind: 'media';
  mediaType: 'image' | 'video' | 'audio';
  poster: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  imageOnly: boolean;
  loopHoldMs?: number | null;
}
export type TemplateDemo = {
  id: string; title: string; description: string; author: string; tags: string[];
  style?: string; usage?: string; accent: string; meta: string;
  type: 'Prototype' | 'Slides' | 'Image' | 'Video' | 'HyperFrames' | 'Audio';
  subtype: string; referencePath: string; business?: string;
  cardMedia: MediaPreviewSpec | null;
  posterSrc: string | null; previewSrc: string | null; previewVideo: string | null;
  prompt: string;
};
/** Selection is a caller-owned capability, not a chat product dependency. */
export interface AssetLibrarySelection {
  purpose?: 'reference' | string;
  controller: AbortController;
  onSelect: (asset: PersonalAsset) => boolean | Promise<boolean>;
}
