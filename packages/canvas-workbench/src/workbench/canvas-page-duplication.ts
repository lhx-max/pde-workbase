import type { CanvasBasicNode } from './BasicCanvasNode';
import { projectFetch, type CanvasHostContext } from '../platform/api-base';

/** Copy every editable version, keeping relative asset URLs in the same directory. */
export async function duplicateCanvasPage(
  source: CanvasBasicNode,
  context: CanvasHostContext,
  shouldApply: () => boolean,
): Promise<Partial<CanvasBasicNode> | undefined> {
  const currentPath = source.projectFilePath || source.generation?.previewPath;
  const paths = [...new Set([currentPath, ...(source.resultHistory || []).map(item => item.projectFilePath)]
    .filter((path): path is string => typeof path === 'string' && Boolean(path)))];
  const copies = new Map<string, string>();
  const created: string[] = [];
  const encoded = (path: string) => path.split('/').map(encodeURIComponent).join('/');
  try {
    // Read all versions before writing any files, so a missing version cannot create a partial card.
    const contents = await Promise.all(paths.map(async path => {
      const response = await projectFetch(`/raw/${encoded(path)}`, { cache: 'no-store' }, context);
      if (!response.ok) throw new Error(`${path} (HTTP ${response.status})`);
      return response.text();
    }));
    for (const [index, path] of paths.entries()) {
      if (!shouldApply()) return undefined;
      const slash = path.lastIndexOf('/');
      const destination = `${path.slice(0, slash + 1)}canvas-copy-${crypto.randomUUID()}.html`;
      created.push(destination);
      const response = await projectFetch('/files', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: destination, content: contents[index] }),
      }, context);
      if (!response.ok) throw new Error(`${path} (HTTP ${response.status})`);
      copies.set(path, destination);
    }
    if (!shouldApply()) return undefined;
    created.length = 0;
    return {
      projectFilePath: currentPath ? copies.get(currentPath) : undefined,
      generation: undefined,
      resultHistory: source.resultHistory?.map(snapshot => ({
        ...snapshot,
        ...(typeof snapshot.projectFilePath === 'string' ? { projectFilePath: copies.get(snapshot.projectFilePath) } : {}),
      })),
    };
  } finally {
    // Roll back only the new, uniquely named files after failure or a stale selection.
    await Promise.allSettled(created.map(path => projectFetch(`/raw/${encoded(path)}`, { method: 'DELETE' }, context)));
  }
}
