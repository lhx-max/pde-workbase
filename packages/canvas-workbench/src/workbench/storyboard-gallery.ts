import type { StoryboardAsset } from '@bezier/contracts';
import { getImageDisplaySize, type WorkbenchImage } from './ImageAssetNode';
import type { StoryboardShot } from './storyboard-card';
import { assetsForStoryboard } from './storyboard-assets';
import { selectedStoryboardShotImage } from './storyboard-shot-images';
import type { StoryboardRelationTarget } from './storyboard-relations';
import { VISUAL_NODE_SIZE } from './visual-node-size';
import { fitGroupBounds, rebaseGroupPoint, planGroupGeometry } from './canvas-group-operations';
import { cr } from '../locales/canvas-remainder';

type Script = { id: string; x: number; y: number; width?: number; height?: number; storyboard?: { shots: StoryboardShot[]; assets?: StoryboardAsset[] } };
export type StoryboardGalleryMember = {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  name: string;
  assetId?: string;
  variantId?: string;
  shotId?: string;
  frame?: 'first' | 'last';
  versions?: Array<{ id: string; path: string }>;
  absorbedIds?: string[];
};
export type StoryboardGallery = {
  id: string;
  storyboardId: string;
  kind: 'character' | 'scene' | 'shot';
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  members: StoryboardGalleryMember[];
};

export type StoryboardGroupChainEdge = {
  id: string;
  source: string;
  sourceHandle?: string;
  target: string;
  data: { storyboardRelation: true };
};

/** The script consumes each whole input group. Individual assets never wire to shot rows. */
export function storyboardGroupChainEdges(
  scripts: Script[],
  galleries: StoryboardGallery[],
  positions: Record<string, { x: number; y: number }>,
): StoryboardGroupChainEdge[] {
  return scripts.filter(script => script.storyboard).flatMap(script => (['character', 'scene'] as const).map(kind => {
    const assetGroupId = `storyboard-assets:${script.id}:${kind}`;
    const gallery = galleries.find(item => item.storyboardId === script.id && item.kind === kind);
    const source = gallery?.id || assetGroupId;
    const sourceX = gallery?.x ?? positions[assetGroupId]?.x ?? script.x - 540;
    const reversed = sourceX > script.x;
    return {
      id: `chain-${assetGroupId}`,
      source,
      ...(gallery ? { sourceHandle: reversed ? 'relation-left' : 'relation-right' } : reversed ? { sourceHandle: 'relation-left' } : {}),
      target: script.id,
      data: { storyboardRelation: true as const },
    };
  }));
}

/** Resolve the small, in-group wires shown for the current explicit relation selection. */
export function storyboardRelationGalleryLinks(
  galleries: StoryboardGallery[],
  shots: StoryboardShot[],
  assets: StoryboardAsset[],
  focus?: StoryboardRelationTarget,
) {
  if (!focus) return [];
  const shot = focus.kind === 'shot' ? shots.find(item => item.id === focus.id) : undefined;
  const refs = shot
    ? [...(shot.characters || []), ...(shot.scene ? [shot.scene] : [])]
    : focus.kind === 'asset'
      ? [{ assetId: focus.id, variantId: focus.variantId }]
      : [];
  // A shot resolves an omitted variant to its current default. Clicking an asset
  // card means the whole asset, so all generated variants remain discoverable.
  const resolved = refs.map(ref => ({
    assetId: ref.assetId,
    variantId: focus.kind === 'shot'
      ? ref.variantId || assets.find(asset => asset.id === ref.assetId)?.variants[0]?.id
      : ref.variantId,
  }));
  return galleries.flatMap(gallery => gallery.kind === 'shot' ? [] : gallery.members.flatMap(member => {
    if (!member.assetId) return [];
    const match = resolved.find(ref => ref.assetId === member.assetId && (!ref.variantId || !member.variantId || ref.variantId === member.variantId));
    return match ? [{ galleryId: gallery.id, assetId: member.assetId, variantId: member.variantId, memberId: member.id }] : [];
  }));
}

/** Positions are relative to a stable layout anchor, not membership changes. */
export function commitGalleryPositions(galleries: StoryboardGallery[], positions: Record<string, { x: number; y: number }>, moved: Array<{ id: string; x: number; y: number }>) {
  const result = { ...positions };
  const changes = new Map(moved.map(item => [item.id, item]));
  for (const gallery of galleries) {
    const anchor = positions[gallery.id] || { x: gallery.x, y: gallery.y };
    const groupMove = changes.get(gallery.id);
    // Capture existing siblings too: future members can then be identified as new,
    // and dragging one member never implicitly relocates untouched siblings.
    if (groupMove || gallery.members.some(member => changes.has(member.id))) {
      for (const member of gallery.members) result[`${gallery.id}:member:${member.id}`] = rebaseGroupPoint(member, gallery, anchor);
    }
    if (groupMove) result[gallery.id] = { x: anchor.x + groupMove.x - gallery.x, y: anchor.y + groupMove.y - gallery.y };
    for (const member of gallery.members) {
      const change = changes.get(member.id);
      if (!change) continue;
      result[gallery.id] ||= anchor;
      result[`${gallery.id}:member:${member.id}`] = rebaseGroupPoint(change, gallery, anchor);
    }
  }
  return result;
}

/** Storyboard-to-image provenance stays in data, but is not rendered as a canvas wire. */
export function visibleStoryboardEdges<T extends { source: string; target: string }>(edges: T[], scripts: Script[], assets: StoryboardAsset[], images: WorkbenchImage[]): T[] {
  const references = new Set<string>();
  for (const asset of assets) for (const variant of asset.variants) {
    if (variant.generationNodeId) references.add(variant.generationNodeId);
    for (const image of images) {
      if ((variant.generationNodeId && image.sourceInstanceId === variant.generationNodeId) ||
        (image.path && (image.path === variant.referencePath || variant.history?.some(item => item.path === image.path)))) {
        references.add(image.id);
        if (image.sourceInstanceId) references.add(image.sourceInstanceId);
      }
    }
  }
  const owners = new Map(scripts.filter(script => script.storyboard).map(script => [script.id, script.storyboard!]));
  return edges.filter(edge => {
    const storyboard = owners.get(edge.source);
    if (!storyboard) return true;
    if (references.has(edge.target)) return false;
    return !storyboard.shots.some(shot => [shot, shot.tailFrame].some(frame => frame && (frame.imageNodeId === edge.target || frame.imageNodeHistoryIds?.includes(edge.target))));
  });
}

/** Presentation only: never changes files, ownership, source IDs or user-created groups. */
export function layoutStoryboardGalleries(scripts: Script[], assets: StoryboardAsset[], images: WorkbenchImage[], detached: Record<string, boolean>, positions: Record<string, { x: number; y: number }>): StoryboardGallery[] {
  const claimed = new Set<string>();
  const galleries: StoryboardGallery[] = [];
  for (const script of scripts) {
    if (!script.storyboard) continue;
    const shots = script.storyboard.shots;
    const scriptAssets = assetsForStoryboard(script.storyboard, assets);
    const kinds = ['character', 'scene', 'shot'] as const;
    const firstGallery = galleries.length;
    const nextX = script.x + Math.max(1320, script.width || 0) + 80;
    for (const kind of kinds) {
      const relevantAssets = scriptAssets.filter(asset => asset.kind === kind);
      const members: Array<{ image: WorkbenchImage; label: string; assetId?: string; variantId?: string; shotId?: string; frame?: 'first' | 'last' }> = [];
      const append = (image: WorkbenchImage, label: string, relation: { assetId?: string; variantId?: string; shotId?: string; frame?: 'first' | 'last' } = {}) => {
        const nodeId = image.embeddedInSource ? image.sourceInstanceId : image.id;
        if (!nodeId || claimed.has(nodeId) || detached[nodeId] || image.groupId || image.excludeFromAutoGroup) return;
        claimed.add(nodeId); members.push({ image: { ...image, id: nodeId }, label, ...relation });
      };
      if (kind === 'shot') {
        shots.forEach((shot, index) => {
          for (const frame of ['first', 'last'] as const) {
            const state = frame === 'first' ? shot : shot.tailFrame;
            if (!state) continue;
            const sources = new Set([state.imageNodeId, ...(state.imageNodeHistoryIds || [])]);
            images.filter(image => image.sourceInstanceId && sources.has(image.sourceInstanceId)).forEach(image => append(image, cr().shotFrame(String(index + 1).padStart(2, '0'), frame), { shotId: shot.id, frame }));
          }
        });
      } else {
        relevantAssets.forEach(asset => {
          asset.variants.forEach(variant => {
            images.filter(image => (variant.generationNodeId && image.sourceInstanceId === variant.generationNodeId) || (image.path && (image.path === variant.referencePath || variant.history?.some(h => h.path === image.path)))).forEach((image, version) => append(image, `${asset.name} · ${version + 1}`, { assetId: asset.id, variantId: variant.id }));
          });
        });
      }
      // Even an unlinked role/scene control occupies a real card in the lane.
      if (!members.length && !relevantAssets.length) continue;
      const id = `storyboard-gallery:v2:${script.id}:${kind}`;
      const stacks = new Map<string, Array<{ id: string; path: string }>>();
      const absorbed = new Map<string, string[]>();
      if (kind === 'shot') {
        for (const [index, shot] of shots.entries()) {
          for (const frame of ['first', 'last'] as const) {
          const state = frame === 'first' ? shot : shot.tailFrame;
          if (!state) continue;
          const ready = members.filter(member => member.shotId === shot.id && member.frame === frame && member.image.path && member.image.status !== 'generating' && member.image.status !== 'failed');
          if (!ready.length) continue;
          const versions = ready.map(member => ({ id: member.image.id, path: member.image.path! }));
          stacks.set(`${shot.id}:${frame}`, versions);
          for (const member of ready) members.splice(members.indexOf(member), 1);
          const chosen = selectedStoryboardShotImage(state, images);
          const label = cr().shotFrame(String(index + 1).padStart(2, '0'), frame);
          members.push({ image: { ...chosen, id: `storyboard-stack:${script.id}:shot:${shot.id}${frame === 'last' ? ':last' : ''}`, x: 0, y: 0, name: label, status: 'ready' }, label, shotId: shot.id, frame });
          }
        }
      } else {
        for (let index = members.length - 1; index >= 0; index--) {
          const member = members[index]!;
          if (!member.image.path || member.image.status === 'generating' || member.image.status === 'failed') continue;
          const key = `${member.assetId}:${member.variantId}`;
          const versions = stacks.get(key) || [];
          versions.unshift({ id: member.image.id, path: member.image.path });
          stacks.set(key, versions);
          members.splice(index, 1);
        }
        for (const asset of relevantAssets) for (const variant of asset.variants) {
          const key = `${asset.id}:${variant.id}`;
          const versions = stacks.get(key) || [];
          for (const item of variant.history || []) if (!versions.some(v => v.path === item.path)) versions.push({ id: item.id, path: item.path });
          if (variant.referencePath && !versions.some(v => v.path === variant.referencePath)) versions.push({ id: variant.referenceNodeId || variant.referencePath, path: variant.referencePath });
          const tasks = members.filter(member => member.assetId === asset.id && member.variantId === variant.id);
          if (!versions.length && !tasks.length) continue;
          absorbed.set(key, tasks.map(member => member.image.id));
          for (const task of tasks) members.splice(members.indexOf(task), 1);
          stacks.set(key, versions);
          const chosenImage = images.find(image => image.path === (variant.referencePath || versions[0]?.path));
          members.push({ image: { ...chosenImage, id: `storyboard-stack:${script.id}:${asset.id}:${variant.id}`, x: 0, y: 0, name: asset.name, status: 'ready' }, label: asset.name, assetId: asset.id, variantId: variant.id });
        }
      }
      const sizes = members.map(({ image }) => {
        const size = getImageDisplaySize(image.naturalWidth, image.naturalHeight);
        return image.id.startsWith('storyboard-stack:') ? { width: size.width, height: size.height + 94 } : image.embeddedInSource ? VISUAL_NODE_SIZE[image.ratio || '1:1'] : size;
      });
      // Only rendered cards contribute to bounds; future batches and transient
      // prompt overlays must not become permanent blank space.
      const cellW = Math.max(0, ...sizes.map(s => s.width));
      const cellH = Math.max(0, ...sizes.map(s => s.height));
      const columns = kind === 'shot' ? Math.max(1, Math.min(2, members.length)) : 1;
      const geometry = members.map(({ image }, index) => ({ id: image.id,
        x: (kind === 'shot' ? 0 : 492) + (index % columns) * (cellW + 32),
        y: kind === 'shot' ? Math.floor(index / columns) * (cellH + 64) : sizes.slice(0, index).reduce((sum, size) => sum + size.height + 64, 0),
        width: sizes[index]!.width, height: sizes[index]!.height }));
      if (kind !== 'shot') {
        const count = relevantAssets.length;
        // Header, padding and every 98px asset row, including the 10px row gaps.
        const height = 86 + Math.max(1, count) * 98 + Math.max(0, count - 1) * 10;
        geometry.unshift({ id: `storyboard-assets:${script.id}:${kind}`, x: 0, y: 0, width: 460, height });
      }
      // Use the same world-to-group geometry as the native multi-select group.
      const layout = geometry.length >= 2 ? planGroupGeometry(id, geometry, 24) : {
        group: { width: geometry[0]!.width + 48, height: geometry[0]!.height + 48 },
        placements: geometry.map(item => ({ ...item, x: 24, y: 24 })),
      };
      const { width, height } = layout.group;
      const position = positions[id] || { x: nextX, y: script.y };
      if (kind === 'shot' && !positions[id]) {
        const obstacles = [...scripts.filter(node => node.id !== script.id).map(node => ({ ...node, width: node.width || 460, height: node.height || 400 })), ...galleries.filter(group => !positions[group.id])];
        for (let attempt = 0; attempt <= obstacles.length; attempt += 1) {
          const hits = obstacles.filter(rect => position.x < rect.x + rect.width + 80 && position.x + width + 80 > rect.x && position.y < rect.y + rect.height + 48 && position.y + height + 48 > rect.y);
          if (!hits.length) break;
          position.x = Math.max(...hits.map(rect => rect.x + rect.width + 80));
        }
      }
      const shotNumbers = shots.flatMap((shot, index) => members.some(member => member.shotId === shot.id) ? [String(index + 1).padStart(2, '0')] : []);
      galleries.push({ id, storyboardId: script.id, kind, title: kind === 'character' ? cr().subjectGroup : kind === 'scene' ? cr().sceneGroup : cr().storyboardShots(shotNumbers.join('、')), ...position, width, height, members: layout.placements.filter(item => item.id !== `${id}:reservation`).map(item => {
        const member = members.find(candidate => candidate.image.id === item.id);
        return { id: item.id, x: item.x, y: item.y, width: item.width, height: item.height, name: member?.label || '', assetId: member?.assetId, variantId: member?.variantId, shotId: member?.shotId, frame: member?.frame, absorbedIds: absorbed.get(`${member?.assetId}:${member?.variantId}`), versions: item.id.startsWith('storyboard-stack:') ? stacks.get(member?.shotId ? `${member.shotId}:${member.frame}` : `${member?.assetId}:${member?.variantId}`) : undefined };
      }) });
    }
    // Inputs belong before the script; only shot outputs belong after it.
    // Measure the actual cards first, then place the input column as one unit.
    const inputs = galleries.slice(firstGallery).filter(group => !group.id.endsWith(':shot'));
    if (inputs.length) {
      const width = Math.max(...inputs.map(group => group.width));
      let x = script.x - width - 80;
      const defaults = inputs.map((group, index) => ({
        group, y: script.y + inputs.slice(0, index).reduce((sum, item) => sum + item.height + 80, 0),
      }));
      const obstacles = [
        ...scripts.filter(node => node.id !== script.id).map(node => ({ ...node, width: node.width || 460, height: node.height || 400 })),
        ...galleries.slice(0, firstGallery).filter(group => !positions[group.id]),
      ];
      for (let attempt = 0; attempt <= obstacles.length; attempt += 1) {
        const hits = obstacles.filter(rect => defaults.some(({ group, y }) =>
          x < rect.x + rect.width + 80 && x + group.width + 80 > rect.x &&
          y < rect.y + rect.height + 48 && y + group.height + 48 > rect.y));
        if (!hits.length) break;
        x = Math.min(...hits.map(rect => rect.x - width - 80));
      }
      for (const { group, y } of defaults) {
        if (!positions[group.id]) Object.assign(group, { x, y });
      }
    }
  }
  return galleries.map(group => {
    const saved = group.members.filter(member => positions[`${group.id}:member:${member.id}`]);
    const placed = saved.map(member => ({ ...member, ...positions[`${group.id}:member:${member.id}`]! }));
    const members = group.members.map(member => {
      const stored = positions[`${group.id}:member:${member.id}`];
      if (stored) return { ...member, ...stored };
      if (!saved.length) return member;
      if (group.kind !== 'shot' && !member.id.startsWith('storyboard-assets:')) {
        const outputs = placed.filter(other => !other.id.startsWith('storyboard-assets:'));
        const control = placed.find(other => other.id.startsWith('storyboard-assets:'));
        const first = outputs[0];
        const next = { ...member,
          x: first?.x ?? (control ? control.x + (control.width || 460) + 32 : member.x),
          y: outputs.length ? Math.max(...outputs.map(other => other.y + (other.height || 330))) + 64 : control?.y ?? member.y,
        };
        placed.push(next);
        return next;
      }
      // Layout defaults are local to the original anchor. Once members move,
      // place new output against the actual related card, not that stale origin.
      const related = placed.find(other => member.shotId && other.shotId === member.shotId && other.frame === 'first') || placed[0]!;
      const width = member.width || 420, height = member.height || 330;
      const candidates = placed.flatMap(other => [
        { x: other.x + (other.width || 420) + 32, y: other.y },
        { x: other.x, y: other.y + (other.height || 330) + 64 },
        { x: other.x - width - 32, y: other.y },
        { x: other.x, y: other.y - height - 64 },
      ]).filter(point => placed.every(other => !(point.x < other.x + (other.width || 420) + 16 && point.x + width + 16 > other.x && point.y < other.y + (other.height || 330) + 16 && point.y + height + 16 > other.y)));
      candidates.sort((a, b) => Math.hypot(a.x - related.x, a.y - related.y) - Math.hypot(b.x - related.x, b.y - related.y));
      const point = candidates[0] || { x: related.x, y: Math.max(...placed.map(other => other.y + (other.height || 330))) + 64 };
      const next = { ...member, ...point };
      placed.push(next);
      return next;
    });
    if (!members.length) return group;
    const bounds = fitGroupBounds(members.map(member => ({ ...member, width: member.width ?? 0, height: member.height ?? 0 })), 24);
    if (!bounds) return group;
    return { ...group, x: group.x + bounds.x, y: group.y + bounds.y,
      width: bounds.width, height: bounds.height,
      members: members.map(member => ({ ...member, ...rebaseGroupPoint(member, { x: 0, y: 0 }, bounds) })),
    };
  });
}
