import type { StoryboardAsset, StoryboardAssetRef } from '@bezier/contracts';
import type { WorkbenchImage } from './ImageAssetNode';
import type { StoryboardPlan, StoryboardShot } from './storyboard-card';
import type { StoryboardRelationTarget } from './storyboard-relations';
import { sac, STORYBOARD_DEFAULT_VARIANT_NAME } from '../locales/storyboard-assets-copy';

/** A script owns its extracted/manual assets and explicit shot references, never the whole library. */
export function assetsForStoryboard(plan: { assets?: StoryboardAsset[]; shots: StoryboardShot[] } | undefined, assets: StoryboardAsset[]) {
  const ids = new Set(plan?.assets?.map(asset => asset.id));
  for (const shot of plan?.shots || []) {
    if (shot.scene) ids.add(shot.scene.assetId);
    for (const ref of shot.characters || []) ids.add(ref.assetId);
  }
  return assets.filter(asset => ids.has(asset.id));
}

/** A saved script freezes the latest referenced cast/locations, never another script's stale seeds. */
export function snapshotStoryboard(plan: StoryboardPlan, library: StoryboardAsset[]): StoryboardPlan {
  const merged = new Map((plan.assets || []).map(asset => [asset.id, asset]));
  for (const asset of library) merged.set(asset.id, asset);
  return JSON.parse(JSON.stringify({ ...plan, assets: assetsForStoryboard(plan, [...merged.values()]) })) as StoryboardPlan;
}

export type StoryboardAssetLibrary = {
  storyboardId?: string;
  defaultVisualStyle?: string;
  relation?: StoryboardRelationTarget;
  pinnedRelation?: StoryboardRelationTarget;
  onHoverRelation?: (target?: StoryboardRelationTarget) => void;
  onPinRelation?: (target?: StoryboardRelationTarget) => void;
  onClearRelation?: () => void;
  onArrangeRelated?: () => void;
  focusedAssetId?: string;
  onFocusAsset?: (id: string | undefined) => void;
  imageNodeIds?: string[];
  assets: StoryboardAsset[];
  images: WorkbenchImage[];
  feedback?: Record<string, string>;
  onUpload?: (file: File) => Promise<{ path: string; src?: string }>;
  onSave: (asset: StoryboardAsset) => void;
  onRemove?: (assetId: string) => void;
  onSetShotAssociation?: (assetId: string, shotId: string, linked: boolean) => void;
  onFocusShotImage?: (shotId: string, frame?: 'first' | 'last') => void;
  onGenerateShot?: (shotId: string, prompt: string, count: number, frame?: 'first' | 'last', imageRatio?: StoryboardPlan['aspectRatio']) => Promise<void>;
  onUseShotImage?: (shotId: string, path: string, frame: 'first' | 'last') => void;
  onCreateShotVideo?: (shotId: string) => void;
  onGenerate: (asset: StoryboardAsset, variantId: string) => void | Promise<void>;
};

/** Characters are multi-select; a shot has one scene. Preserve other references. */
export function setStoryboardAssetAssociation(shot: StoryboardShot, asset: StoryboardAsset, linked: boolean): StoryboardShot {
  const exists = asset.kind === 'scene' ? shot.scene?.assetId === asset.id : shot.characters?.some(ref => ref.assetId === asset.id);
  if (Boolean(exists) === linked) return shot;
  return { ...shot, ...(asset.kind === 'scene'
    ? { scene: linked ? { assetId: asset.id } : undefined }
    : { characters: linked ? [...(shot.characters || []), { assetId: asset.id }] : (shot.characters || []).filter(ref => ref.assetId !== asset.id) }),
    ...(shot.imageNodeId ? { imageAssetRevisions: {} } : {}),
  };
}

/** Only explicit identity matches may retain edits; names are presentation, not identity. */
export function mergeStoryboardAssets(current: StoryboardAsset[], seeds: StoryboardAsset[]) {
  const assets = [...current];
  const ids = new Map<string, string>();
  for (const seed of seeds) {
    const existing = assets.find(asset => asset.id === seed.id);
    if (existing) ids.set(seed.id, existing.id);
    else { assets.push(seed); ids.set(seed.id, seed.id); }
  }
  return { assets, ids };
}

export function storyboardAssetId(kind: StoryboardAsset['kind'], name: string): string {
  return `${kind}:${encodeURIComponent(name.trim().normalize('NFKC').toLocaleLowerCase())}`;
}

/** Upgrade legacy name-based identities before exposing a script's asset controls.
 * Keep the old library entry as an archive; never delete its generated files.
 * Legacy generation edges identify the real owner, not node order or asset name.
 */
export function isolateStoryboardAssets<T extends { id: string; storyboard?: StoryboardPlan }>(
  nodes: T[], library: StoryboardAsset[], edges: Array<{ source: string; target: string }>,
) {
  const byId = new Map(library.map(asset => [asset.id, asset]));
  const consumers = new Map<string, Set<string>>();
  for (const node of nodes) {
    const ids = new Set([...(node.storyboard?.assets || []).map(a => a.id),
      ...(node.storyboard?.shots || []).flatMap(s => [...(s.characters || []), ...(s.scene ? [s.scene] : [])].map(r => r.assetId))]);
    for (const id of ids) { const owners = consumers.get(id) || new Set<string>(); owners.add(node.id); consumers.set(id, owners); }
  }
  let assets = library;
  const next = nodes.map(node => {
    const plan = node.storyboard;
    if (!plan) return node;
    const seeds = new Map((plan.assets || []).map(a => [a.id, a]));
    for (const shot of plan.shots) for (const ref of [...(shot.characters || []), ...(shot.scene ? [shot.scene] : [])]) {
      if (!seeds.has(ref.assetId) && byId.has(ref.assetId)) seeds.set(ref.assetId, byId.get(ref.assetId)!);
    }
    const remaps = new Map<string, string>();
    const owned = [...seeds.values()].map(seed => {
      const originAssetId = seed.originAssetId || seed.id;
      const id = seed.ownerStoryboardId === node.id ? seed.id : `storyboard-asset:${encodeURIComponent(node.id)}:${encodeURIComponent(originAssetId)}`;
      remaps.set(seed.id, id);
      const saved = byId.get(id);
      if (saved) return saved;
      const legacy = byId.get(seed.id);
      const isShared = (consumers.get(seed.id)?.size || 0) > 1;
      const generationOwners = new Set((legacy?.variants || seed.variants).flatMap(v => {
        const generators = new Set([v.generationNodeId, ...(v.history || []).map(h => h.nodeId)].filter(Boolean));
        return edges.filter(e => generators.has(e.target)).map(e => e.source);
      }));
      const claimedElsewhere = library.some(a => a.originAssetId === originAssetId && a.ownerStoryboardId && a.ownerStoryboardId !== node.id);
      const ownsLegacy = !seed.ownerStoryboardId && (generationOwners.size > 0
        ? generationOwners.size === 1 && generationOwners.has(node.id)
        : !isShared && !claimedElsewhere);
      const source = ownsLegacy && legacy ? legacy : seed;
      const asset = { ...source, id, originAssetId, ownerStoryboardId: node.id,
        variants: source.variants.map(v => {
          // A copied/shared seed can already contain another script's generated state.
          if (!ownsLegacy && (seed.ownerStoryboardId !== node.id) && (v.generationNodeId || v.history?.some(h => h.nodeId))) {
            const { generationNodeId: _g, referencePath: _p, referenceNodeId: _n, history: _h, ...settings } = v;
            return settings;
          }
          return { ...v, history: v.history?.map(h => ({ ...h })), inputReferences: v.inputReferences ? [...v.inputReferences] : undefined };
        }),
      };
      if (assets === library) assets = [...library];
      assets.push(asset); byId.set(id, asset);
      return asset;
    });
    if (![...remaps].some(([from, to]) => from !== to)) return node;
    const remap = (ref: StoryboardAssetRef) => ({ ...ref, assetId: remaps.get(ref.assetId) || ref.assetId });
    const revisions = (values?: Record<string, number>) => values && Object.fromEntries(Object.entries(values).map(([id, revision]) => [remaps.get(id) || id, revision]));
    return { ...node, storyboard: { ...plan, assets: owned, shots: plan.shots.map(shot => ({ ...shot,
      characters: shot.characters?.map(remap), scene: shot.scene ? remap(shot.scene) : undefined,
      imageAssetRevisions: revisions(shot.imageAssetRevisions),
      tailFrame: shot.tailFrame ? { ...shot.tailFrame, imageAssetRevisions: revisions(shot.tailFrame.imageAssetRevisions) } : undefined,
    })) } };
  });
  return { nodes: next.some((n, i) => n !== nodes[i]) ? next : nodes, assets };
}

export function resolveStoryboardAsset(ref: StoryboardAssetRef, assets: StoryboardAsset[]) {
  const asset = assets.find(item => item.id === ref.assetId);
  if (!asset) return undefined;
  const variant = asset.variants.find(item => item.id === (ref.variantId || asset.activeVariantId)) || asset.variants[0];
  return { asset, variant };
}

export function storyboardShotReferences(shot: StoryboardShot, assets: StoryboardAsset[]) {
  return [...(shot.characters || []), ...(shot.scene ? [shot.scene] : [])]
    .flatMap(ref => { const resolved = resolveStoryboardAsset(ref, assets); return resolved ? [resolved] : []; });
}

export function storyboardReferenceImage(variant: StoryboardAsset['variants'][number] | undefined, images: WorkbenchImage[]) {
  if (!variant) return undefined;
  // Explicit reference selection wins over generated candidates.
  return images.find(image => image.path && image.path === variant.referencePath)
    || (variant.generationNodeId ? images.find(image => image.sourceInstanceId === variant.generationNodeId && image.path && image.status !== 'failed' && image.status !== 'generating') : undefined);
}

export function storyboardSceneView(variant: StoryboardAsset['variants'][number]) {
  return variant.sceneView || 'default';
}

export function storyboardAssetImageRatio(asset: StoryboardAsset, variantId: string) {
  const variant = asset.variants.find(v => v.id === variantId);
  if (variant?.imageRatio && ['16:9', '9:16', '1:1', '4:3', '3:4'].includes(variant.imageRatio)) return variant.imageRatio;
  return asset.kind === 'scene' || (variant?.view ?? 'three') === 'three' ? '16:9' as const : '3:4' as const;
}

export function storyboardAssetPrompt(asset: StoryboardAsset, variantId: string, defaultVisualStyle = '') {
  const copy = sac();
  const variant = asset.variants.find(item => item.id === variantId);
  const style = asset.visualStyle?.trim() || defaultVisualStyle.trim();
  const description = storyboardAssetDescription(asset, variantId);
  const sceneView = variant ? storyboardSceneView(variant) : 'default';
  const view = asset.kind === 'scene'
    ? ({ default: '', wide: copy.sceneWide, multi: copy.sceneMulti, top: copy.sceneTop, detail: copy.sceneDetail }[sceneView])
    : (variant?.view ?? 'three') === 'three' ? copy.subjectThree : variant?.view === 'front' ? copy.subjectFront : variant?.view === 'detail' ? copy.subjectDetail : '';
  const time = asset.kind === 'scene' && variant?.timeOfDay ? ({ default: '', day: copy.timeDay, dusk: copy.timeDusk, night: copy.timeNight }[variant.timeOfDay]) : '';
  const referencePolicy = variant?.inputReferences?.length ? copy.refPolicyOnlyUser : copy.refPolicyNone;
  const styleLine = style && !description.includes(style) ? `\n${copy.visualStyle(style)}` : '';
  const viewLine = view ? `\n${copy.viewRequirement(view)}` : '';
  const timeLine = time ? `\n${copy.timeRequirement(time)}` : '';
  return `${asset.kind === 'character' ? copy.genSubject : copy.genScene}\n${referencePolicy}\n${asset.name}\n${description}${styleLine}${viewLine}${timeLine}`;
}

export function storyboardAssetDescription(asset: StoryboardAsset, variantId: string) {
  const copy = sac();
  const variant = asset.variants.find(v => v.id === variantId);
  return variant?.descriptionOverride ?? [asset.description, variant?.description, variant?.prompt ? copy.promptSupplement(variant.prompt) : '', asset.visualStyle ? copy.visualStyle(asset.visualStyle) : ''].filter(Boolean).join('\n');
}

/** Select the first successful result of each new batch, then preserve manual selections. */
export function reconcileStoryboardAssetImages(assets: StoryboardAsset[], images: WorkbenchImage[]) {
  let changed = false;
  const next = assets.map(asset => {
    let assetChanged = false;
    const variants = asset.variants.map(variant => {
      if (!variant.generationNodeId) return variant;
      const results = images.filter(i => i.sourceInstanceId === variant.generationNodeId && i.path && i.status !== 'generating' && i.status !== 'failed');
      const additions = results.filter(i => !(variant.history || []).some(h => h.id === i.id));
      if (!additions.length) return variant;
      const history = [...(variant.history || [])];
      const started = history.some(h => h.nodeId === variant.generationNodeId);
      if (variant.referencePath && !history.some(h => h.path === variant.referencePath)) history.push({ id: `previous:${variant.referencePath}`, path: variant.referencePath });
      history.push(...additions.map(i => ({ id: i.id, path: i.path!, nodeId: variant.generationNodeId })));
      assetChanged = true;
      return { ...variant, history, ...(!started ? { referencePath: additions[0]!.path!, referenceNodeId: additions[0]!.id } : {}) };
    });
    if (!assetChanged) return asset;
    changed = true;
    return { ...asset, variants, revision: asset.revision + 1 };
  });
  return changed ? next : assets;
}

/** Asset generation uses only references explicitly selected by the user. */
export function storyboardAssetGenerationAttachments(asset: StoryboardAsset, variantId: string) {
  const selected = asset.variants.find(v => v.id === variantId);
  const copy = sac();
  return [...new Set(selected?.inputReferences || [])].map((path, i) => ({ name: copy.referenceName(asset.name, i), path, mimeType: 'image/png', size: 0 }));
}

/** Number only attached images, in the exact attachment order. Text-only assets take no slot. */
export function storyboardReferenceImageLabels(references: Array<{ assetId: string; name: string; path?: string }>, assets: StoryboardAsset[]) {
  const copy = sac();
  const attached = references.filter(ref => ref.path);
  return attached.length ? [copy.refMappingHeader, ...attached.map((ref, index) =>
    copy.refMappingLine(index, assets.find(asset => asset.id === ref.assetId)?.kind === 'scene' ? 'scene' : 'character', ref.name),
  )].join('\n') : '';
}

export function storyboardReferenceContext(shot: StoryboardShot, assets: StoryboardAsset[]) {
  const copy = sac();
  const context = storyboardShotReferences(shot, assets).map(({ asset, variant }) => {
    const kindLabel = asset.kind === 'character' ? copy.kindSubject : copy.kindScene;
    const variantBit = variant?.name && variant.name !== STORYBOARD_DEFAULT_VARIANT_NAME ? copy.variantParen(variant.name) : '';
    return copy.settingColon(copy.settingLine(kindLabel, asset.name, variantBit), storyboardAssetDescription(asset, variant?.id || ''));
  }).join('\n');
  return context ? `${copy.shotContextIntro}\n${context}` : '';
}
