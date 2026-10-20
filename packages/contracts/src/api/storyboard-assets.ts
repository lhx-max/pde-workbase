/** Storyboard-owned subjects and locations. Names never imply shared identity. */
export type StoryboardAssetVariant = {
  id: string;
  name: string;
  description: string;
  prompt?: string;
  descriptionOverride?: string;
  view?: 'default' | 'three' | 'front' | 'detail';
  sceneView?: 'default' | 'wide' | 'multi' | 'top' | 'detail';
  timeOfDay?: 'default' | 'day' | 'dusk' | 'night';
  imageCount?: 1 | 2 | 4;
  imageRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
  inputReferences?: string[];
  history?: Array<{ id: string; path: string; nodeId?: string }>;
  referencePath?: string;
  referenceNodeId?: string;
  generationNodeId?: string;
};
export type StoryboardAsset = {
  id: string;
  ownerStoryboardId?: string;
  originAssetId?: string;
  kind: 'character' | 'scene';
  name: string;
  description: string;
  revision: number;
  visualStyle?: string;
  activeVariantId?: string;
  variants: StoryboardAssetVariant[];
};
export type StoryboardAssetRef = { assetId: string; variantId?: string };
export const STORYBOARD_ASSETS_STATE_KEY = 'workbenchStoryboardAssets';
