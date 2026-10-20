export type ImageGenerationLineage = {
  parentImageId?: string;
  parentGroupId?: string;
  embedInSource: boolean;
  markSourceCardBusy: boolean;
  sourceNodeId: string;
};

type TrackedImageTaskLineage = {
  parentImageId?: string;
  parentGroupId?: string;
};

export type ImageLineageNode = {
  id: string;
  sourceInstanceId?: string;
  embeddedInSource?: boolean;
  parentImageId?: string;
  parentGroupId?: string;
};

export type ImageLineageEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

type ImageLineageConnection = Pick<ImageLineageEdge, 'source' | 'target'>;

/**
 * A reference added through an image's plus button already has a graph edge to
 * a newly created visual card. Its first output belongs inside that empty card;
 * it is not a child image of the reference asset.
 */
export function resolveGenerationParent(input: {
  instanceId: string;
  sourceImageId?: string;
  sourceGroupId?: string;
  images: ImageLineageNode[];
  edges: ImageLineageConnection[];
  hasEmbeddedOutput: boolean;
}): { parentImageId?: string; parentGroupId?: string; fillSourceCard: boolean } {
  // Repeating a populated visual card branches from its existing image. Only
  // an empty card may absorb the first result; storyboard galleries separately
  // group these independent outputs into their shot/asset version stacks.
  const sourceImageId = input.sourceImageId || (!input.sourceGroupId && input.hasEmbeddedOutput
    ? input.images.find(image => image.sourceInstanceId === input.instanceId && image.embeddedInSource)?.id
    : undefined);
  let visibleReferenceSource: string | undefined;
  if (input.sourceGroupId) {
    visibleReferenceSource = input.sourceGroupId;
  } else if (sourceImageId) {
    const image = input.images.find(item => item.id === sourceImageId);
    visibleReferenceSource = image?.embeddedInSource
      ? image.sourceInstanceId
      : image?.id;
  }
  const linkedToEmptySourceCard = !input.hasEmbeddedOutput
    && Boolean(visibleReferenceSource)
    && input.edges.some(edge => (
      edge.source === visibleReferenceSource
      && edge.target === input.instanceId
    ));

  if (linkedToEmptySourceCard) {
    return { parentImageId: undefined, parentGroupId: undefined, fillSourceCard: true };
  }
  return {
    parentImageId: sourceImageId,
    parentGroupId: input.sourceGroupId || undefined,
    fillSourceCard: false,
  };
}

/** Length-prefixing keeps ids collision-free even when node ids contain hyphens. */
export function imageLineageEdgeId(source: string, target: string): string {
  return `image-lineage:${source.length}:${source}:${target}`;
}

/**
 * Resolve where a generated image belongs before a task is submitted.
 *
 * A generation started from an existing image or image group is always a new
 * child node. Only the first output of a root generation may fill an empty
 * visual source card.
 */
export function resolveImageGenerationLineage(input: {
  instanceId: string;
  sourceImageId?: string;
  sourceGroupId?: string;
  outputIndex: number;
}): ImageGenerationLineage {
  const parentImageId = input.sourceImageId || undefined;
  const parentGroupId = input.sourceGroupId || undefined;
  const isRootGeneration = !parentImageId && !parentGroupId;

  return {
    parentImageId,
    parentGroupId,
    embedInSource: isRootGeneration && input.outputIndex === 0,
    markSourceCardBusy: isRootGeneration,
    sourceNodeId: parentImageId || parentGroupId || input.instanceId,
  };
}

/** Secondary image tasks render their own child cards and must not busy the source card. */
export function countSourceCardImageTasks(input: {
  activeImageTasks?: TrackedImageTaskLineage[];
  legacyTaskId?: string;
  legacySourceImageId?: string;
  legacySourceGroupId?: string;
}): number {
  const activeRootTasks = (input.activeImageTasks || []).filter(task => (
    !task.parentImageId && !task.parentGroupId
  )).length;
  const legacyRootTask = input.legacyTaskId
    && !input.legacySourceImageId
    && !input.legacySourceGroupId
    ? 1
    : 0;
  return activeRootTasks + legacyRootTask;
}

/** Place a child in the next column beside the image the user actually selected. */
export function resolveChildImageColumnX(input: {
  instanceX: number;
  sourceCardWidth: number;
  parentX: number;
  parentWidth: number;
  parentEmbeddedInSource?: boolean;
  gap: number;
}): number {
  const visibleParentRight = input.parentEmbeddedInSource
    ? input.instanceX + input.sourceCardWidth
    : input.parentX + input.parentWidth;
  return visibleParentRight + input.gap;
}

/**
 * Image metadata is the source of truth for generated-image lineage.
 *
 * The first generated image may be embedded in its visual source card, so it
 * has no independent React Flow node. Children of that image must therefore
 * connect from the owning visual card instead of the embedded image id.
 */
export function deriveImageLineage(input: {
  images: ImageLineageNode[];
  instanceIds?: Iterable<string>;
  groupIds?: Iterable<string>;
}): { edges: ImageLineageEdge[]; managedTargetIds: Set<string> } {
  const imagesById = new Map(input.images.map(image => [image.id, image]));
  const instanceIds = input.instanceIds ? new Set(input.instanceIds) : undefined;
  const groupIds = input.groupIds ? new Set(input.groupIds) : undefined;
  const managedTargetIds = new Set<string>();
  const edges: ImageLineageEdge[] = [];

  for (const image of input.images) {
    if (image.embeddedInSource) continue;
    if (!image.parentImageId && !image.parentGroupId && !image.sourceInstanceId) continue;
    managedTargetIds.add(image.id);

    let source: string | undefined;
    if (image.parentGroupId) {
      if (groupIds && !groupIds.has(image.parentGroupId)) continue;
      source = image.parentGroupId;
    } else if (image.parentImageId) {
      const parent = imagesById.get(image.parentImageId);
      if (!parent) continue;
      if (parent.embeddedInSource) {
        if (!parent.sourceInstanceId || (instanceIds && !instanceIds.has(parent.sourceInstanceId))) continue;
        source = parent.sourceInstanceId;
      } else {
        source = parent.id;
      }
    } else if (image.sourceInstanceId) {
      if (instanceIds && !instanceIds.has(image.sourceInstanceId)) continue;
      source = image.sourceInstanceId;
    }

    if (!source || source === image.id) continue;
    edges.push({
      id: imageLineageEdgeId(source, image.id),
      source,
      target: image.id,
    });
  }

  return { edges, managedTargetIds };
}

function imageLineageEdgesEqual(left: ImageLineageEdge[], right: ImageLineageEdge[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((edge, index) => {
    const candidate = right[index];
    if (!candidate) return false;
    return edge.id === candidate.id
      && edge.source === candidate.source
      && edge.target === candidate.target
      && edge.sourceHandle === candidate.sourceHandle
      && edge.targetHandle === candidate.targetHandle;
  });
}

/**
 * Replace only deterministic image-lineage edges. Manual edges use a timestamp
 * suffix and all non-image structural edges are preserved.
 */
export function reconcileImageLineageEdges(
  current: ImageLineageEdge[],
  derived: ImageLineageEdge[],
  managedTargetIds: ReadonlySet<string>,
): ImageLineageEdge[] {
  const retained = current.filter(edge => !(
    managedTargetIds.has(edge.target)
    && (
      edge.id === imageLineageEdgeId(edge.source, edge.target)
      || edge.id === `e-${edge.source}-${edge.target}`
    )
  ));
  const retainedIds = new Set(retained.map(edge => edge.id));
  const retainedPairs = new Set(retained.map(edge => `${edge.source}\u0000${edge.target}`));
  const next = [
    ...retained,
    ...derived.filter(edge => (
      !retainedIds.has(edge.id)
      && !retainedPairs.has(`${edge.source}\u0000${edge.target}`)
    )),
  ];
  return imageLineageEdgesEqual(current, next) ? current : next;
}
