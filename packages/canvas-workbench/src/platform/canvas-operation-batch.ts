import { canvasOperationsRequestSchema, type CanvasOperation } from '@bezier/contracts';
type State = Record<string, unknown>;
type Item = Record<string, unknown> & { id: string };
const items = (v: unknown): Item[] => Array.isArray(v) ? v : [];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const rebaseConflict = (): never => { throw Object.assign(new Error('画布内容已变化，未覆盖远端修改'), { status: 409 }); };
const editable = new Set(['title', 'text', 'x', 'y', 'width', 'height', 'textEntryMode']);

/** Convert existing optimistic UI edits into the public text/image command contract.
 * Unsupported editors keep the legacy path, which uses the same lock and
 * conflict checks. Never truncate an unsupported change to make it fit.
 */
export function canvasOperationBatch(base: State, changes: State, context: State = {}): CanvasOperation[] | null {
  if (Object.keys(changes).some(k => !['workbenchBasicNodes','workbenchEdges','workbenchImages'].includes(k))) return null;
  const operations: CanvasOperation[] = [];
  const priorImages=items(base.workbenchImages), nextImages=items(changes.workbenchImages);
  if('workbenchImages' in changes) {
    for(const node of priorImages) if(!nextImages.some(n=>n.id===node.id)) operations.push({type:'node.delete',nodeId:node.id});
    const imageFields=new Set(['id','path','src','name','x','y','naturalWidth','naturalHeight','status','assetKind','resultHistory','replacementRequestId','sourceAsset','sourceProjectFilePath']);
    for(const node of nextImages) {
      const old=priorImages.find(n=>n.id===node.id);
      if(same(old,node)) continue;
      if(!old) {
        if(Object.keys(node).some(k=>!imageFields.has(k)) || !node.path || !/\.(png|jpe?g|webp|avif)$/i.test(String(node.path)) || node.status==='generating') return null;
        const source=priorImages.find(n=>n.path===node.path);
        if(source && same({...source,id:node.id,x:node.x,y:node.y,resultHistory:node.resultHistory},node)) operations.push({type:'node.duplicate',nodeId:source.id,newNodeId:node.id,x:Number(node.x),y:Number(node.y)});
        else {
          const asset=node.sourceAsset as {assetId?:string;versionId?:string}|undefined;
          operations.push({type:'image.attach',nodeId:node.id,source:asset?.assetId?{assetId:asset.assetId,versionId:asset.versionId}:{path:String(node.path)},name:typeof node.name==='string'?node.name:undefined,x:Number(node.x),y:Number(node.y)});
        }
      } else {
        const keys=[...new Set([...Object.keys(old),...Object.keys(node)])].filter(k=>!same(old[k],node[k]));
        if (keys.every(k=>k==='x'||k==='y')) operations.push({type:'node.move',nodeId:node.id,x:Number(node.x),y:Number(node.y)});
        else if(node.path && old.path!==node.path && keys.every(k=>imageFields.has(k) && k!=='id' && k!=='x' && k!=='y' && k!=='assetKind')) {
          if(items(old.resultHistory).some(v=>v.path===node.path)) operations.push({type:'image.select',nodeId:node.id,path:String(node.path),expectedPath:String(old.path)});
          else operations.push({type:'image.replace',nodeId:node.id,source:{path:String(node.path)},expectedPath:old.path?String(old.path):undefined});
        } else return null;
      }
    }
  }
  const before = items(base.workbenchBasicNodes), after = items(changes.workbenchBasicNodes);
  if ('workbenchBasicNodes' in changes) {
    for (const node of before) {
      if (!after.some(n => n.id === node.id)) {
        if (!['text','page'].includes(String(node.kind))) return null;
        operations.push({ type: 'node.delete', nodeId: node.id });
      }
    }
    for (const node of after) {
      const old = before.find(n => n.id === node.id);
      if (same(old, node)) continue;
      if (!['text','page'].includes(String(node.kind))) return null;
      if (!old && node.kind==='page') {
        if(Object.keys(node).some(k=>!['id','kind','artifactFormat','x','y','width','height','title','text'].includes(k))) return null;
        operations.push({type:'document.create',nodeId:node.id,format:node.artifactFormat==='presentation'?'presentation':'html',x:Number(node.x),y:Number(node.y),title:String(node.title||''),prompt:String(node.text||''),width:Number(node.width||420),height:Number(node.height||300)});
        continue;
      }
      if (!old) {
        const source = before.find(n => n.kind === 'text' && n.projectFilePath && n.projectFilePath === node.projectFilePath);
        if (source) {
          const copied = { ...source, id: node.id, x: node.x, y: node.y };
          if (!same(copied, node)) return null;
          operations.push({ type: 'node.duplicate', nodeId: source.id, newNodeId: node.id, x: Number(node.x), y: Number(node.y) });
        } else {
          if (Object.keys(node).some(k => !editable.has(k) && k !== 'id' && k !== 'kind')) return null;
          operations.push({ type: 'node.create', node: node as Extract<CanvasOperation, {type: 'node.create'}>['node'] });
        }
      } else {
        const changedKeys = [...new Set([...Object.keys(old), ...Object.keys(node)])].filter(k => !same(old[k], node[k]));
        // Inline copy-on-write assigns a path locally; the server stages the
        // same text edit and returns its authoritative document path.
        if (changedKeys.some(k => !editable.has(k) && !(node.kind === 'text' && k === 'projectFilePath' && old.text !== node.text))) return null;
        const set = Object.fromEntries(changedKeys.filter(k => editable.has(k)).map(k => [k, node[k]]));
        if (Object.values(set).some(v => v === undefined)) return null;
        if (Object.keys(set).length) operations.push({ type: 'node.update', nodeId: node.id, set });
      }
    }
  }
  if ('workbenchEdges' in changes) {
    const previous = items(base.workbenchEdges), next = items(changes.workbenchEdges);
    const deletedNodes = new Set(operations.filter(o => o.type === 'node.delete').map(o => o.nodeId));
    // Remove changed edges first so reconnects don't conflict with themselves.
    const disconnects: CanvasOperation[] = [];
    for (const edge of previous) {
      if (next.some(e => same(e, edge))) continue;
      if (!deletedNodes.has(String(edge.source)) && !deletedNodes.has(String(edge.target))) disconnects.push({ type: 'edge.disconnect', edgeId: edge.id });
    }
    operations.unshift(...disconnects);
    for (const edge of next) {
      if (!previous.some(e => same(e, edge))) operations.push({ type: 'edge.connect', edge: edge as Extract<CanvasOperation, {type: 'edge.connect'}>['edge'] });
    }
  }
  if (!operations.length) return null;
  const known:Item[] = [...before, ...after, ...items(context.workbenchBasicNodes), ...[...priorImages,...nextImages,...items(context.workbenchImages)].map(n=>({...n,kind:'image'}))];
  const ids = operations.flatMap(op => op.type === 'edge.connect' ? [op.edge.source, op.edge.target]
    : op.type === 'edge.disconnect' ? items(base.workbenchEdges).filter(e => e.id === op.edgeId).flatMap(e => [String(e.source), String(e.target)])
    : 'nodeId' in op ? [op.nodeId] : []);
  if (ids.some(id => !['text','image','page'].includes(String(known.find(n => n.id === id)?.kind)))) return null;
  if(ids.some(id=>known.some(n=>n.id===id && (n.groupId || n.embeddedInSource || n.workflowRunId || n.parentId)))) return null;
  if (ids.some(id => Object.entries(context).some(([key, value]) => /Groups|groups/.test(key) && JSON.stringify(value)?.includes(JSON.stringify(id))))) return null;
  const parsed = canvasOperationsRequestSchema.safeParse({ operationId: 'ui', baseRevision: 0, operations });
  return parsed.success ? (parsed.data.operations as CanvasOperation[]) : null;
}

/** Rebase edits typed while an acknowledged save was in flight. Server-owned
 * paths/defaults survive unless the user actually changed that field. */
export function rebaseCanvasDraft(base: unknown, local: unknown, remote: unknown): unknown {
  if (same(base, local)) return remote;
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)
    && [...base, ...local, ...remote].every(n => n && typeof n.id === 'string')) {
    const b = new Map(base.map(n => [n.id, n])), r = new Map(remote.map(n => [n.id, n]));
    for (const node of base) {
      if (!local.some(n => n.id === node.id) && r.has(node.id) && !same(node, r.get(node.id))) rebaseConflict();
    }
    for (const node of local) {
      if (!b.has(node.id) && r.has(node.id) && !same(node, r.get(node.id))) rebaseConflict();
    }
    return [...local.map(n => b.has(n.id) ? rebaseCanvasDraft(b.get(n.id), n, r.get(n.id)) : n),
      ...remote.filter(n => !b.has(n.id) && !local.some(l => l.id === n.id))];
  }
  if ([base, local, remote].every(n => n && typeof n === 'object' && !Array.isArray(n))) {
    const b = base as State, l = local as State, next = { ...remote as State };
    for (const key of new Set([...Object.keys(b), ...Object.keys(l)])) {
      if (!(key in l)) {
        if (key in next && !same(b[key], next[key])) rebaseConflict();
        delete next[key];
      }
      else next[key] = rebaseCanvasDraft(b[key], l[key], next[key]);
    }
    return next;
  }
  if (!same(base, remote) && !same(local, remote)) rebaseConflict();
  return local;
}
