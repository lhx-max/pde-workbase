import type { StoryboardAsset, StoryboardAssetRef } from './storyboard-assets.js';
import { validateReportStoryboard, type ReportStoryboardRequirements } from './report-storyboard.js';
type StoryboardAspectRatio = '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
type StoryboardShotSize = '远景' | '全景' | '中景' | '近景' | '特写';
type StoryboardCameraMovement = '固定' | '推进' | '拉远' | '横移' | '跟拍' | '环绕';
type StoryboardReferenceRole = 'character' | 'scene' | 'style' | 'prop';
type StoryboardShot = { id: string; characters: StoryboardAssetRef[]; scene?: StoryboardAssetRef; description: string; shotSize: StoryboardShotSize; cameraMovement: StoryboardCameraMovement; durationSec: number; dialogue: string; lighting: string; sound: string; finalPrompt: string };
export type StoryboardGenerationDefaults = { aspectRatio: StoryboardAspectRatio; visualStyle: string; referenceRoles: Record<string, StoryboardReferenceRole> };
export type StoryboardGenerationPlan = StoryboardGenerationDefaults & { version: 1; assets: StoryboardAsset[]; shots: StoryboardShot[] };
function createId(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`}`;
}
function storyboardAssetId(kind: StoryboardAsset['kind'], name: string): string {
  return `${kind}:${encodeURIComponent(name.trim().normalize('NFKC').toLocaleLowerCase())}`;
}
const ASPECT_RATIOS: readonly StoryboardAspectRatio[] = ['16:9', '9:16', '1:1', '4:3', '3:4'];
const SHOT_SIZES: readonly StoryboardShotSize[] = ['远景', '全景', '中景', '近景', '特写'];
const CAMERA_MOVEMENTS: readonly StoryboardCameraMovement[] = ['固定', '推进', '拉远', '横移', '跟拍', '环绕'];

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && options.includes(value as T);
}

function extractJsonObject(content: string): unknown {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
  const candidate = fenced || trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error('模型未返回可读取的分镜 JSON');
  }
}

/** Parse Agent output defensively so malformed responses never corrupt the card. */
export function parseStoryboardGenerationResult(content: string, current: StoryboardGenerationDefaults, requirements?: ReportStoryboardRequirements): StoryboardGenerationPlan {
  const value = extractJsonObject(content);
  if (!value || typeof value !== 'object' || !Array.isArray((value as { shots?: unknown }).shots)) {
    throw new Error('分镜结果缺少 shots 数组');
  }
  const raw = value as { aspectRatio?: unknown; visualStyle?: unknown; shots: unknown[]; assets?: unknown[] };
  if (requirements) {
    const budgets = raw.shots.map(shot => {
      const duration = shot && typeof shot === 'object' ? (shot as { durationSec?: unknown }).durationSec : undefined;
      if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 4 || duration > 30) throw new Error('分镜时长必须是 4–30 秒的有效数值，未采用结果');
      return { durationSec: duration };
    });
    validateReportStoryboard(budgets, requirements);
  }
  const assets: StoryboardAsset[] = Array.isArray(raw.assets) ? raw.assets.flatMap(value => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    if ((item.kind !== 'character' && item.kind !== 'scene') || typeof item.name !== 'string' || !item.name.trim()) return [];
    return [{ id: storyboardAssetId(item.kind, item.name), kind: item.kind, name: item.name.trim(), description: typeof item.description === 'string' ? item.description.trim() : '待补充', revision: 1, variants: [{ id: 'default', name: '默认', description: '' }] }];
  }) : [];
  const shots = raw.shots.slice(0, 50).flatMap(shot => {
    if (!shot || typeof shot !== 'object') return [];
    const item = shot as Record<string, unknown>;
    const description = typeof item.description === 'string' ? item.description.trim() : '';
    if (!description) return [];
    const names: Array<{ kind: StoryboardAsset['kind']; name: string }> = [
      ...(Array.isArray(item.characters) ? item.characters.filter((name): name is string => typeof name === 'string' && Boolean(name.trim())).map(name => ({ kind: 'character' as const, name })) : []),
      ...(typeof item.scene === 'string' && item.scene.trim() ? [{ kind: 'scene' as const, name: item.scene }] : []),
    ];
    for (const { kind, name } of names) {
      const id = storyboardAssetId(kind, name);
      if (!assets.some(asset => asset.id === id)) assets.push({ id, kind, name: name.trim(), description: '待补充', revision: 1, variants: [{ id: 'default', name: '默认', description: '' }] });
    }
    const duration = typeof item.durationSec === 'number' ? item.durationSec : Number(item.durationSec);
    return [{
      id: createId('shot'),
      characters: Array.isArray(item.characters) ? item.characters.filter((name): name is string => typeof name === 'string' && Boolean(name.trim())).map(name => ({ assetId: storyboardAssetId('character', name) })) : [],
      ...(typeof item.scene === 'string' && item.scene.trim() ? { scene: { assetId: storyboardAssetId('scene', item.scene) } } : {}),
      description,
      shotSize: isOneOf(item.shotSize, SHOT_SIZES) ? item.shotSize : '中景',
      cameraMovement: isOneOf(item.cameraMovement, CAMERA_MOVEMENTS) ? item.cameraMovement : '固定',
      durationSec: requirements ? duration : Math.min(30, Math.max(4, Math.round(Number.isFinite(duration) ? duration : 4))),
      dialogue: typeof item.dialogue === 'string' ? item.dialogue.trim() : '',
      lighting: typeof item.lighting === 'string' ? item.lighting.trim() : '',
      sound: typeof item.sound === 'string' ? item.sound.trim() : '',
      finalPrompt: typeof item.finalPrompt === 'string' ? item.finalPrompt.trim() : '',
    } satisfies StoryboardShot];
  });
  if (shots.length === 0) throw new Error('分镜结果里没有可用镜头');
  if (requirements) validateReportStoryboard(shots, requirements);
  return {
    version: 1,
    aspectRatio: isOneOf(raw.aspectRatio, ASPECT_RATIOS) ? raw.aspectRatio : current.aspectRatio,
    visualStyle: typeof raw.visualStyle === 'string' ? raw.visualStyle.trim() : current.visualStyle,
    referenceRoles: { ...current.referenceRoles },
    assets,
    shots,
  };
}
