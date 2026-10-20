import { canvasTextPath } from '@bezier/contracts';
type State = Record<string, unknown>;
type Item = Record<string, unknown> & { id: string };
const items = (v: unknown): Item[] => Array.isArray(v) ? v : [];

/** Keep the derived text inputs in the same commit as text/edge changes.
 * Image inputs to text cards are resolved here; other target kinds retain their adapters.
 */
export function reconcileTextOperationReferences(state: State, previous: State): State {
  const nodes = items(state.workbenchBasicNodes), edges = items(state.workbenchEdges), images=items(state.workbenchImages);
  const textIds = new Set([...nodes, ...items(previous.workbenchBasicNodes)].filter(n => n.kind === 'text' || n.kind === 'page').map(n => n.id));
  [...images,...items(previous.workbenchImages)].forEach(n=>textIds.add(n.id));
  return { ...state, workbenchBasicNodes: nodes.map(node => {
    if (node.kind !== 'text') return node;
    const current = items(node.linkedAttachments);
    const derived: Record<string, unknown>[] = [];
    for (const edge of edges.filter(e => e.target === node.id)) {
      if ((edge.data as Record<string, unknown> | undefined)?.skipSourceContext) continue;
      const source = nodes.find(n => n.id === edge.source && n.kind === 'text');
      if (source) {
        const path = String(source.projectFilePath || canvasTextPath(source.id));
        const attachment = { name: String(source.title || '').trim() || path.split('/').at(-1)!, path,
          size: 0, mimeType: String(source.sourceMime || 'text/markdown'), sourceNodeId: source.id,
          ...(source.text ? { content: source.text } : {}) };
        if (!derived.some(a => a.sourceNodeId === source.id && a.path === path)) derived.push(attachment);
      } else if(nodes.some(n=>n.id===edge.source && n.kind==='page' && n.projectFilePath)) {
        const source=nodes.find(n=>n.id===edge.source)!;
        derived.push({name:source.title || source.projectFilePath,path:source.projectFilePath,size:0,mimeType:'text/html',sourceNodeId:source.id});
      } else if(images.some(n=>n.id===edge.source && n.path)) {
        const source=images.find(n=>n.id===edge.source)!;
        const path=String(source.path), extension=path.split('.').at(-1)?.toLowerCase();
        const mimeType:Record<string,string>={jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',svg:'image/svg+xml',avif:'image/avif',tiff:'image/tiff'};
        derived.push({name:source.name || path.split('/').at(-1),path,size:0,mimeType:mimeType[extension || ''] || 'image/png',sourceNodeId:source.id,
          ...(source.naturalWidth?{naturalWidth:source.naturalWidth}:{}),...(source.naturalHeight?{naturalHeight:source.naturalHeight}:{})});
      } else {
        derived.push(...current.filter(a => a.sourceNodeId === edge.source && !textIds.has(String(a.sourceNodeId))));
      }
    }
    if (!derived.length && !current.length) return node;
    return { ...node, linkedAttachments: derived };
  }) };
}
