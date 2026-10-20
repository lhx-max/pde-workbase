import type { StoryboardAsset, StoryboardAssetRef, ReportStoryboardRequirements } from '@bezier/contracts';
import { storyboardAssetDescription, storyboardReferenceContext } from './storyboard-assets';
import type { StoryboardShotSize, StoryboardCameraMovement } from '../locales/storyboard-enums';
export type { StoryboardShotSize, StoryboardCameraMovement };
import { STORYBOARD_SHOT_SIZES, STORYBOARD_CAMERA_MOVEMENTS, SHOT_SIZE_MEDIUM, CAMERA_MOVEMENT_STATIC } from '../locales/storyboard-enums';
import { sc, buildStoryboardShotPromptLocalized } from '../locales/storyboard-card-copy';
import {
  videoCameraMoveSummary,
  VIDEO_CAMERA_MOVES, VIDEO_CAMERA_SPEEDS, VIDEO_CAMERA_SHOTS,
  type VideoCameraMove,
} from './video-camera-move';

export type StoryboardAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
export type StoryboardReferenceRole = 'character' | 'scene' | 'style' | 'prop';
export type StoryboardGenerationType = 'general' | 'short-drama';

export type StoryboardFrame = {
  imageRatio?: StoryboardAspectRatio;
  imageNodeId?: string;
  imageInputSignature?: string;
  imageNodeHistoryIds?: string[];
  imageAssetRevisions?: Record<string, number>;
  selectedImagePath?: string;
  imageSources?: Record<string, { prompt: string; references: Array<{ assetId: string; name: string; path?: string; revision: number }> }>;
};
export type StoryboardShot = StoryboardFrame & {
  characters?: StoryboardAssetRef[];
  scene?: StoryboardAssetRef;
  tailFrame?: StoryboardFrame;
  videoNodeId?: string;
  id: string;
  description: string;
  shotSize: StoryboardShotSize;
  cameraMovement: StoryboardCameraMovement;
  /** Full camera constraint shared with video generation; legacy movement remains for old cards and prompts. */
  cameraMove?: VideoCameraMove;
  durationSec: number;
  dialogue: string;
  lighting?: string;
  sound?: string;
  finalPrompt?: string;
};

export type StoryboardPlan = {
  /** Text-only extraction seeds; promoted into the project library by the host. */
  assets?: StoryboardAsset[];
  version: 1;
  aspectRatio: StoryboardAspectRatio;
  visualStyle: string;
  referenceRoles: Record<string, StoryboardReferenceRole>;
  shots: StoryboardShot[];
};

function createId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`}`;
}

export function createStoryboardShot(description = ''): StoryboardShot {
  return {
    id: createId('shot'),
    description,
    shotSize: SHOT_SIZE_MEDIUM,
    cameraMovement: CAMERA_MOVEMENT_STATIC,
    durationSec: 4,
    dialogue: '',
    lighting: '',
    sound: '',
    finalPrompt: '',
  };
}

export function createDefaultStoryboardPlan(): StoryboardPlan {
  return {
    version: 1,
    aspectRatio: '16:9',
    visualStyle: '',
    referenceRoles: {},
    shots: [createStoryboardShot('')],
  };
}

export function cloneStoryboardPlan(plan: StoryboardPlan): StoryboardPlan {
  return {
    ...plan,
    referenceRoles: { ...plan.referenceRoles },
    shots: plan.shots.map(shot => ({
      ...shot,
      imageNodeId: undefined,
      tailFrame: shot.tailFrame ? {} : undefined,
      videoNodeId: undefined,
      selectedImagePath: undefined,
      imageSources: undefined,
      imageInputSignature: undefined,
      imageNodeHistoryIds: undefined,
      imageAssetRevisions: undefined,
      id: createId('shot'),
      ...(shot.cameraMove ? { cameraMove: { ...shot.cameraMove } } : {}),
    })),
  };
}

/** Restore authored asset data only; generated files and canvas ownership are not portable. */
function parseSavedStoryboardAssets(value: unknown): StoryboardAsset[] {
  if (!Array.isArray(value)) return [];
  const assets = new Map<string, StoryboardAsset>();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    if (typeof item.id !== 'string' || !item.id.trim() || typeof item.name !== 'string'
      || !item.name.trim() || (item.kind !== 'character' && item.kind !== 'scene') || assets.has(item.id)) continue;
    const variants = new Map<string, StoryboardAsset['variants'][number]>();
    for (const entry of Array.isArray(item.variants) ? item.variants : []) {
      if (!entry || typeof entry !== 'object') continue;
      const raw = entry as Record<string, unknown>;
      if (typeof raw.id !== 'string' || !raw.id.trim() || typeof raw.name !== 'string' || variants.has(raw.id)) continue;
      const variant: StoryboardAsset['variants'][number] = {
        id: raw.id, name: raw.name, description: typeof raw.description === 'string' ? raw.description : '',
      };
      for (const key of ['prompt', 'descriptionOverride'] as const) if (typeof raw[key] === 'string') variant[key] = raw[key];
      if (isOneOf(raw.view, ['default', 'three', 'front', 'detail'] as const)) variant.view = raw.view;
      if (isOneOf(raw.sceneView, ['default', 'wide', 'multi', 'top', 'detail'] as const)) variant.sceneView = raw.sceneView;
      if (isOneOf(raw.timeOfDay, ['default', 'day', 'dusk', 'night'] as const)) variant.timeOfDay = raw.timeOfDay;
      if (isOneOf(raw.imageRatio, ['16:9', '9:16', '1:1', '4:3', '3:4'] as const)) variant.imageRatio = raw.imageRatio;
      if (raw.imageCount === 1 || raw.imageCount === 2 || raw.imageCount === 4) variant.imageCount = raw.imageCount;
      variants.set(variant.id, variant);
    }
    const asset: StoryboardAsset = {
      id: item.id, kind: item.kind, name: item.name, description: typeof item.description === 'string' ? item.description : '',
      revision: 1, variants: [...variants.values()],
    };
    if (typeof item.visualStyle === 'string') asset.visualStyle = item.visualStyle;
    if (typeof item.activeVariantId === 'string' && variants.has(item.activeVariantId)) asset.activeVariantId = item.activeVariantId;
    assets.set(asset.id, asset);
  }
  return [...assets.values()];
}

function parseSavedStoryboardRef(value: unknown, assets: StoryboardAsset[], kind: StoryboardAsset['kind']): StoryboardAssetRef | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const asset = assets.find(item => item.id === raw.assetId && item.kind === kind);
  if (!asset) return undefined;
  return { assetId: asset.id, ...(typeof raw.variantId === 'string' && asset.variants.some(variant => variant.id === raw.variantId)
    ? { variantId: raw.variantId } : {}) };
}

/** Portable saved scripts restore editable shots, not references to another canvas. */
export function parseSavedStoryboardPlan(content: string): StoryboardPlan {
  const raw = JSON.parse(content);
  if (!raw || !Array.isArray(raw.shots) || !raw.shots.length || raw.shots.length > 50) throw new Error(sc().needShots);
  const plan = createDefaultStoryboardPlan();
  if (['16:9','9:16','1:1','4:3','3:4'].includes(raw.aspectRatio)) plan.aspectRatio = raw.aspectRatio;
  plan.visualStyle = typeof raw.visualStyle === 'string' ? raw.visualStyle : '';
  plan.assets = parseSavedStoryboardAssets(raw.assets);
  plan.shots = raw.shots.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error(sc().invalidShot);
    const item = value as Record<string, unknown>, shot = createStoryboardShot();
    shot.characters = (Array.isArray(item.characters) ? item.characters : []).flatMap(value => {
      const ref = parseSavedStoryboardRef(value, plan.assets || [], 'character');
      return ref ? [ref] : [];
    });
    shot.scene = parseSavedStoryboardRef(item.scene, plan.assets || [], 'scene');
    const ratios = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;
    if (isOneOf(item.imageRatio, ratios)) shot.imageRatio = item.imageRatio;
    if (item.tailFrame && typeof item.tailFrame === 'object') {
      const ratio = (item.tailFrame as Record<string, unknown>).imageRatio;
      shot.tailFrame = isOneOf(ratio, ratios) ? { imageRatio: ratio } : {};
    }
    for (const key of ['description','dialogue','lighting','sound','finalPrompt'] as const) if (typeof item[key] === 'string') shot[key] = item[key];
    if (typeof item.durationSec === 'number' && Number.isFinite(item.durationSec)) shot.durationSec = Math.min(30, Math.max(1,item.durationSec));
    if (isOneOf(item.shotSize, SHOT_SIZES)) shot.shotSize = item.shotSize;
    if (isOneOf(item.cameraMovement, CAMERA_MOVEMENTS)) shot.cameraMovement = item.cameraMovement;
    if (item.cameraMove && typeof item.cameraMove === 'object') {
      const camera = item.cameraMove as VideoCameraMove;
      if (VIDEO_CAMERA_MOVES.some(v=>v.id===camera.move) && VIDEO_CAMERA_SPEEDS.some(v=>v.id===camera.speed) && VIDEO_CAMERA_SHOTS.some(v=>v.id===camera.shot)) shot.cameraMove={move:camera.move,speed:camera.speed,shot:camera.shot};
    }
    return shot;
  });
  return plan;
}

export function storyboardDuration(plan: StoryboardPlan): number {
  return plan.shots.reduce((total, shot) => total + Math.max(0, shot.durationSec || 0), 0);
}

export function moveStoryboardShot(plan: StoryboardPlan, shotId: string, offset: -1 | 1): StoryboardPlan {
  const index = plan.shots.findIndex(shot => shot.id === shotId);
  const target = index + offset;
  if (index < 0 || target < 0 || target >= plan.shots.length) return plan;
  const shots = [...plan.shots];
  const [shot] = shots.splice(index, 1);
  shots.splice(target, 0, shot!);
  return { ...plan, shots };
}

export function reorderStoryboardShot(
  plan: StoryboardPlan,
  shotId: string,
  targetShotId: string,
  placement: 'before' | 'after',
): StoryboardPlan {
  if (shotId === targetShotId) return plan;
  const shot = plan.shots.find(item => item.id === shotId);
  if (!shot || !plan.shots.some(item => item.id === targetShotId)) return plan;

  const shots = plan.shots.filter(item => item.id !== shotId);
  const targetIndex = shots.findIndex(item => item.id === targetShotId);
  shots.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, shot);
  return { ...plan, shots };
}

export function duplicateStoryboardShot(plan: StoryboardPlan, shotId: string): StoryboardPlan {
  const index = plan.shots.findIndex(shot => shot.id === shotId);
  if (index < 0) return plan;
  const shots = [...plan.shots];
  const source = shots[index]!;
  shots.splice(index + 1, 0, {
    ...source,
    tailFrame: source.tailFrame ? {} : undefined,
    videoNodeId: undefined,
    imageNodeId: undefined,
    selectedImagePath: undefined,
    imageSources: undefined,
    imageInputSignature: undefined,
    imageNodeHistoryIds: undefined,
    imageAssetRevisions: undefined,
    id: createId('shot'),
    ...(source.cameraMove ? { cameraMove: { ...source.cameraMove } } : {}),
  });
  return { ...plan, shots };
}

export function removeStoryboardShot(plan: StoryboardPlan, shotId: string): StoryboardPlan {
  if (plan.shots.length <= 1) return plan;
  return { ...plan, shots: plan.shots.filter(shot => shot.id !== shotId) };
}

export function buildStoryboardShotPrompt(plan: StoryboardPlan, shot: StoryboardShot): string {
  return buildStoryboardShotPromptLocalized(plan, shot);
}

/** Turn an editable storyboard into plain context that downstream cards can consume. */
export function storyboardPlanToText(plan: StoryboardPlan): string {
  const copy = sc();
  return [
    copy.planHeader(plan.aspectRatio, storyboardDuration(plan)),
    ...(plan.visualStyle.trim() ? [copy.styleLine(plan.visualStyle.trim())] : []),
    ...plan.shots.map((shot, index) => [
      copy.shotHeader(
        String(index + 1).padStart(2, '0'),
        shot.shotSize,
        shot.cameraMove ? videoCameraMoveSummary(shot.cameraMove) : shot.cameraMovement,
        shot.durationSec,
      ),
      shot.description.trim() || copy.descriptionPending,
      storyboardReferenceContext(shot, plan.assets || []),
      shot.lighting?.trim() ? copy.lightingLine(shot.lighting.trim()) : '',
      shot.dialogue.trim() ? copy.dialogueLine(shot.dialogue.trim()) : '',
      shot.sound?.trim() ? copy.soundLine(shot.sound.trim()) : '',
      shot.finalPrompt?.trim() ? copy.finalPromptLine(shot.finalPrompt.trim()) : '',
    ].filter(Boolean).join('\n')),
  ].join('\n\n');
}

const SHOT_SIZES = STORYBOARD_SHOT_SIZES;
const CAMERA_MOVEMENTS = STORYBOARD_CAMERA_MOVEMENTS;

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && options.includes(value as T);
}

/** Build a strict, attachment-driven task for the host Agent. */
export function buildStoryboardGenerationPrompt(
  plan: StoryboardPlan,
  supplemental = '',
  generationType: StoryboardGenerationType = 'general',
  assets: StoryboardAsset[] = [],
  requirements?: ReportStoryboardRequirements,
): string {
  const copy = sc();
  const requestedAspectRatio = generationType === 'short-drama' ? '9:16' : plan.aspectRatio;
  const prompt = [
    copy.readBrief,
    ...(generationType === 'short-drama' ? [copy.shortDramaSkill] : []),
    copy.requirementsLabel,
    requirements
      ? copy.reqTier(requirements.tier, requirements.shotCount, requirements.totalDurationSec)
      : generationType === 'short-drama'
      ? copy.reqShortDrama
      : copy.reqGeneral,
    copy.req2,
    copy.req3,
    copy.req4,
    copy.req5(requestedAspectRatio),
    copy.shotSizeEnumLine,
    copy.cameraEnumLine,
    requirements ? copy.req8Strict : copy.req8,
    copy.req9,
    copy.existingAssets(JSON.stringify(assets.map(asset => ({ kind: asset.kind, name: asset.name, description: storyboardAssetDescription(asset, asset.activeVariantId || asset.variants[0]?.id || '') })))),
    copy.jsonOnly,
    copy.jsonExample,
  ];
  if (supplemental.trim()) {
    prompt.splice(1, 0, copy.userSupplemental(supplemental.trim()));
  }
  return prompt.join('\n');
}

// The daemon and canvas share the same result parser.
export { parseStoryboardGenerationResult } from '@bezier/contracts';
