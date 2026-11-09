import { cr } from '../locales/canvas-remainder';
/** Resolve the complete ordered group before submitting; never silently drop a member. */
export async function materializeGroupReferences<T extends { path: string; size: number }>(
  references: readonly T[],
  io: {
    read: (reference: T) => Promise<Blob>;
    save: (reference: T, content: Blob) => Promise<string>;
    remove: (path: string) => Promise<void>;
  },
): Promise<T[]> {
  const unique = [...new Map(references.map(ref => [ref.path, { ...ref }])).values()];
  // Read the entire selection before any write. A missing last member must not
  // leave the earlier members uploaded or start a partial generation.
  const contents: Blob[] = [];
  for (const ref of unique) {
    const blob = await io.read(ref);
    if (!blob.size) throw new Error(cr().emptyRefRetry);
    contents.push(blob);
  }
  const saved = new Map<string, T>();
  try {
    for (const [index, ref] of unique.entries()) {
      const content = contents[index]!;
      const path = await io.save(ref, content);
      saved.set(ref.path, { ...ref, path, size: content.size });
    }
  } catch (error) {
    const cleanup = await Promise.allSettled([...saved.values()].map(ref => io.remove(ref.path)));
    const message = error instanceof Error ? error.message : cr().saveSnapshotFailed;
    if (cleanup.some(result => result.status === 'rejected')) throw new Error(cr().partialCleanup(message));
    throw error;
  }
  return references.map(ref => ({ ...ref, path: saved.get(ref.path)!.path, size: saved.get(ref.path)!.size }));
}

export function snapshotImageGroupReferences<T extends { id: string; path?: string; name?: string }>(
  memberIds: readonly string[], images: readonly T[], limit: number,
) {
  if (!memberIds.length) throw new Error(cr().groupEmptyAdd);
  const byId = new Map(images.map(image => [image.id, image]));
  const paths = new Set<string>();
  const attachments: { name: string; path: string; size: number; mimeType: string }[] = [];
  for (const id of memberIds) {
    const image = byId.get(id);
    if (!image?.path) throw new Error(cr().groupImagesMissing);
    if (paths.has(image.path)) continue;
    paths.add(image.path);
    attachments.push({ name: image.name || 'reference.png', path: image.path, size: 0, mimeType: 'image/*' });
  }
  if (attachments.length > limit) throw new Error(cr().refLimit(limit, attachments.length));
  return attachments;
}
