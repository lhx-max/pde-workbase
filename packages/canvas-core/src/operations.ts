import type { VideoOperation } from './video.js';
import { applyStoryboardOperation, blankStoryboard, cloneAuthoredShot, hasStoryboardGeneratedReferences } from './storyboard.js';
import type { SketchOperation } from './sketch.js';
import { applyCanvasRelationsLayout } from './relations-layout.js';
import type { DocumentOperation } from './assets.js';
import type { ImageOperation } from './assets.js';
import type { CanvasOperation, CanvasOperationReceipt } from '@bezier/contracts';
import { CanvasStateError } from './errors.js';
import { canonical, equal, mergeCanvasValue } from './merge.js';
export { canonical, equal } from './merge.js';

type State = Record<string, unknown>;
type Item = Record<string, unknown> & { id: string };
export interface StoredCanvasOperation {
  fingerprint: string;
  receipt: CanvasOperationReceipt;
  before: State;
  after: State;
}
export const records = (value: unknown): Item[] => Array.isArray(value) ? value as Item[] : [];
const fail = (code: string, message: string, status = 400): never => { throw new CanvasStateError(status, code, message); };

/** A concurrent reference must not survive the removal of its target. */
export function assertCanvasReferences(before: State, after: State): void {
  const remaining = new Set([...records(after.workbenchBasicNodes),...records(after.workbenchImages),...records(after.workbenchOrganizationGroups)].map(n => n.id));
  const removed = new Set([...records(before.workbenchBasicNodes),...records(before.workbenchImages),...records(before.workbenchOrganizationGroups)].filter(n => !remaining.has(n.id)).map(n => n.id));
  for (const group of records(after.workbenchOrganizationGroups)) {
    if (Array.isArray(group.memberIds) && group.memberIds.some(id => removed.has(String(id))))
      fail('CANVAS_REVISION_CONFLICT', `A group still references a removed node: ${group.id}`, 409);
  }
  for (const edge of records(after.workbenchEdges)) {
    if (removed.has(String(edge.source)) || removed.has(String(edge.target))) {
      fail('CANVAS_REVISION_CONFLICT', `A connection still references a removed node: ${edge.id}`, 409);
    }
  }
}

/** State semantics; optional file effects are explicit host capabilities. */
export async function applyCanvasOperations(state: State, operations: CanvasOperation[], journal: Record<string, StoredCanvasOperation>, image?: (op:ImageOperation, node?:Item)=>Promise<Item>, document?: (op:DocumentOperation,node?:Item)=>Promise<Item>, sketch?: (op:SketchOperation,node?:Item)=>Promise<Item>, video?: (op:VideoOperation,node?:Item)=>Promise<Item>) {
  let next: State = structuredClone(state);
  const touched = new Set<string>();
  const nodeIds = new Set<string>();
  const nodes = () => records(next.workbenchBasicNodes);
  const images = () => records(next.workbenchImages);
  const replaceImages = (items:Item[]) => { next.workbenchImages=items; touched.add('workbenchImages'); };
  const edges = () => records(next.workbenchEdges);
  const replaceNodes = (items: Item[]) => { next.workbenchBasicNodes = items; touched.add('workbenchBasicNodes'); };
  const replaceEdges = (items: Item[]) => { next.workbenchEdges = items; touched.add('workbenchEdges'); };
  const textNode = (id: string, allowImage = false, allCards = false, allowOrganization = false) => {
    const node = [...nodes(),...(allowImage ? images() : [])].find(n => n.id === id);
    if (!node) return fail('CANVAS_NODE_NOT_FOUND', `Node not found: ${id}`, 404);
    if (node.kind !== 'text' && !(allowImage && (images().includes(node) || node.kind==='page')) && !(allCards && ['sketch','storyboard','video'].includes(String(node.kind)))) return fail('CANVAS_OPERATION_UNSUPPORTED', 'This card type is not supported by the requested operation');
    // Group coordinates and workflow-owned cards require their own commands.
    const grouped = Object.entries(next).some(([key, value]) => /Groups|groups/.test(key) && !(allowOrganization && key === 'workbenchOrganizationGroups') && canonical(value)?.includes(JSON.stringify(id)));
    if (node.source || node.storyboardVideoSource || node.parentId || node.workflowRunId || node.groupId || node.embeddedInSource || grouped || (node.kind!=='storyboard' && JSON.stringify(next.workbenchStoryboardAssets || []).includes(JSON.stringify(id))) || (typeof node.path==='string' && JSON.stringify(next.workbenchStoryboardAssets || []).includes(JSON.stringify(node.path))) || nodes().some(n=>n.storyboard && (JSON.stringify(n.storyboard).includes(JSON.stringify(id)) || (typeof node.path==='string' && JSON.stringify(n.storyboard).includes(JSON.stringify(node.path)))))) return fail('CANVAS_OPERATION_UNSUPPORTED', 'Grouped, storyboard or workflow-owned nodes need their dedicated adapter');
    nodeIds.add(id);
    return node;
  };
  const availableId = (id: string) => {
    if (Object.values(next).some(v => Array.isArray(v) && v.some(n => n?.id === id))) fail('CANVAS_ID_EXISTS', `ID already exists: ${id}`, 409);
  };
  for (const op of operations) {
    switch (op.type) {
      case 'storyboard.shot.add': case 'storyboard.shot.update': case 'storyboard.shot.references': case 'storyboard.shot.move': case 'storyboard.shot.delete': case 'storyboard.shot.duplicate': {
        const node=textNode(op.nodeId,true,true);
        const prepared=applyStoryboardOperation(node,op,records(next.workbenchStoryboardAssets));
        replaceNodes(nodes().map(n=>n.id===node.id?prepared:n)); break;
      }
      case 'video.configure': {
        const node=textNode(op.nodeId,true,true);
        if(node.kind!=='video') return fail('CANVAS_OPERATION_UNSUPPORTED','Target is not a video');
        replaceNodes(nodes().map(n=>n.id===node.id?{...n,...op.set}:n)); break;
      }
      case 'video.attach': case 'video.select': {
        if(!video) return fail('CANVAS_CAPABILITY_UNAVAILABLE','Video service unavailable',503);
        const node=textNode(op.nodeId,true,true), prepared=await video(op,node);
        replaceNodes(nodes().map(n=>n.id===node.id?prepared:n)); break;
      }
      case 'sketch.create': case 'sketch.update': {
        if (!sketch) return fail('CANVAS_CAPABILITY_UNAVAILABLE', 'Sketch service unavailable', 503);
        if (op.type === 'sketch.create') availableId(op.nodeId);
        const current = op.type === 'sketch.update' ? textNode(op.nodeId, true, true) : undefined;
        const prepared = await sketch(op, current);
        replaceNodes(op.type === 'sketch.create' ? [...nodes(), prepared] : nodes().map(n => n.id === op.nodeId ? prepared : n));
        nodeIds.add(op.nodeId); break;
      }
      case 'group.create': case 'group.rename': case 'group.add': case 'group.remove': case 'group.dissolve': case 'group.move': case 'layout.arrange': {
        const result = applyCanvasRelationsLayout(next, op);
        next = result.state;
        result.keys.forEach(key => touched.add(key));
        result.nodeIds.forEach(id => nodeIds.add(id));
        break;
      }
      case 'document.create': case 'document.select': case 'document.begin': {
        if(!document) return fail('CANVAS_CAPABILITY_UNAVAILABLE','Document service unavailable',503);
        if(op.type==='document.create') availableId(op.nodeId);
        const current=op.type!=='document.create'?textNode(op.nodeId,true):undefined;
        const prepared=await document(op,current);
        replaceNodes(op.type==='document.create'?[...nodes(),prepared]:nodes().map(n=>n.id===op.nodeId?prepared:n));
        nodeIds.add(op.nodeId);break;
      }
      case 'image.attach': case 'image.replace': case 'image.transform': case 'image.select': {
        if(!image) return fail('CANVAS_CAPABILITY_UNAVAILABLE','Image processor unavailable',503);
        let node:Item|undefined;
        if(op.type==='image.attach') availableId(op.nodeId);
        else { node=textNode(op.nodeId,true); if(!images().includes(node)) fail('CANVAS_OPERATION_UNSUPPORTED','Target is not an image'); }
        const prepared=await image(op,node);
        replaceImages(op.type==='image.attach'?[...images(),prepared]:images().map(n=>n.id===op.nodeId?prepared:n));
        nodeIds.add(op.nodeId); break;
      }
      case 'node.create': {
        availableId(op.node.id);
        const defaults = op.node.kind === 'storyboard'
          ? {title:'分镜',width:560,height:500,storyboard:blankStoryboard(`${op.node.id.slice(0,120)}-shot-0`),storyboardEntryMode:'manual'}
          : op.node.kind === 'video' ? {title:'视频',text:'',width:420,height:300,videoAspect:'16:9',videoLength:5,videoResolution:'720p'}
          : {title:'文字',text:'',width:360,height:240};
        replaceNodes([...nodes(), { ...defaults, ...op.node }]);
        nodeIds.add(op.node.id); break;
      }
      case 'node.update': case 'node.move': case 'node.rename': case 'node.resize': {
        const node = textNode(op.nodeId, true, op.type !== 'node.update');
        if(op.type==='node.update' && images().includes(node)) fail('CANVAS_OPERATION_UNSUPPORTED','Use image operations for image content');
        const set = op.type === 'node.move' ? { x: op.x, y: op.y }
          : op.type === 'node.rename' ? { [images().includes(node) ? 'name' : 'title']: op.title }
          : op.type === 'node.resize' ? { width: op.width, height: op.height } : op.set;
        if(images().includes(node)) replaceImages(images().map(n=>n.id===node.id?{...n,...set}:n));
        else replaceNodes(nodes().map(n => n.id === node.id ? { ...n, ...set } : n)); break;
      }
      case 'node.duplicate': {
        const node = textNode(op.nodeId,true,true); availableId(op.newNodeId);
        if (node.kind==='storyboard' && records(next.workbenchStoryboardAssets).some(a=>a.ownerStoryboardId===node.id)) fail('CANVAS_OPERATION_UNSUPPORTED','Storyboard with owned assets requires the asset duplication adapter');
        if(images().includes(node)) {
          const {taskId:_task,mediaDelivery:_delivery,mediaRequest:_request,generationDraft:_draft,resultHistory:_results,...copy}=node;
          replaceImages([...images(),{...copy,id:op.newNodeId,x:op.x,y:op.y}]); nodeIds.add(op.newNodeId); break;
        }
        if (node.kind === 'sketch') {
          if (!sketch) return fail('CANVAS_CAPABILITY_UNAVAILABLE', 'Sketch service unavailable', 503);
          if (node.sketchPending !== true && typeof node.projectFilePath !== 'string') return fail('CANVAS_SKETCH_NOT_FOUND','Saved sketch path is missing',404);
          const creation: Extract<SketchOperation,{type:'sketch.create'}> = {type:'sketch.create', nodeId:op.newNodeId, x:op.x, y:op.y,
            title:String(node.title || ''), width:typeof node.width==='number'?node.width:undefined, height:typeof node.height==='number'?node.height:undefined};
          let prepared:Item;
          try { prepared=await sketch({...creation,...(typeof node.projectFilePath==='string'?{source:{path:node.projectFilePath}}:{})}); }
          catch (error) {
            if(node.sketchPending!==true || !(error instanceof CanvasStateError) || error.code!=='CANVAS_SKETCH_NOT_FOUND')throw error;
            prepared=await sketch(creation);
          }
          replaceNodes([...nodes(),prepared]); nodeIds.add(op.newNodeId); break;
        }
        if(node.kind==='page' && !document) return fail('CANVAS_CAPABILITY_UNAVAILABLE','Document service unavailable',503);
        if(node.kind==='page' && document) {
          const prepared=await document({type:'document.create',nodeId:op.newNodeId,format:node.artifactFormat==='presentation'?'presentation':'html',title:String(node.title||''),prompt:String(node.text||''),x:op.x,y:op.y,width:typeof node.width==='number'?node.width:undefined,height:typeof node.height==='number'?node.height:undefined,...(typeof node.projectFilePath==='string'?{source:{path:node.projectFilePath}}:{})});
          replaceNodes([...nodes(),prepared]);nodeIds.add(op.newNodeId);break;
        }
        // A duplicate is a new document card, not a duplicate running job.
        const { generation: _generation, resultHistory: _history, videoSubmitRequestId: _submit, videoTask: _task, mediaDelivery: _delivery, ...copy } = node;
        if (node.kind === 'storyboard' && node.storyboard) {
          const plan = structuredClone(node.storyboard) as Record<string, unknown>;
          plan.shots = records(plan.shots).map((shot,index)=>cloneAuthoredShot(shot,`${op.newNodeId.slice(0,120)}-shot-${index}`));
          copy.storyboard = plan;
        }
        replaceNodes([...nodes(), { ...copy, id: op.newNodeId, x: op.x, y: op.y }]);
        nodeIds.add(op.newNodeId); break;
      }
      case 'node.delete': {
        const node=textNode(op.nodeId,true,true);
        if (node.kind==='storyboard' && records(next.workbenchStoryboardAssets).some(a=>a.ownerStoryboardId===node.id)) fail('CANVAS_OPERATION_UNSUPPORTED','Detach owned assets before deleting a storyboard');
        if (node.kind === 'storyboard' && hasStoryboardGeneratedReferences(node.storyboard))
          fail('CANVAS_OPERATION_UNSUPPORTED', 'Storyboard has attached cards; detach them before deleting');
        if(images().includes(node)) replaceImages(images().filter(n=>n.id!==op.nodeId));
        else replaceNodes(nodes().filter(n => n.id !== op.nodeId));
        replaceEdges(edges().filter(e => e.source !== op.nodeId && e.target !== op.nodeId)); break;
      }
      case 'edge.disconnect': {
        const edge = edges().find(e => e.id === op.edgeId);
        if (!edge) fail('CANVAS_EDGE_NOT_FOUND', 'Edge not found', 404);
        if (op.edgeId.startsWith('chain-')) fail('CANVAS_OPERATION_UNSUPPORTED', 'Generated edges cannot be removed');
        textNode(String(edge!.source),true,false,true); textNode(String(edge!.target),true,false,true);
        replaceEdges(edges().filter(e => e.id !== op.edgeId)); break;
      }
      case 'edge.connect': {
        const edge = op.edge; textNode(edge.source,true,false,true); textNode(edge.target,true,false,true); availableId(edge.id);
        if (edge.id.startsWith('chain-') || edge.source === edge.target) fail('CANVAS_INVALID_EDGE', 'Invalid edge');
        if (edges().some(e => e.source === edge.source && e.target === edge.target
          && (e.sourceHandle || null) === (edge.sourceHandle || null) && (e.targetHandle || null) === (edge.targetHandle || null))) fail('CANVAS_INVALID_EDGE', 'Duplicate connection');
        const queue = [edge.target], seen = new Set<string>();
        while (queue.length) {
          const id = queue.pop()!;
          if (id === edge.source) fail('CANVAS_INVALID_EDGE', 'Connection would create a cycle');
          if (seen.has(id)) continue; seen.add(id);
          queue.push(...edges().filter(e => e.source === id).map(e => String(e.target)));
        }
        replaceEdges([...edges(), { ...edge }]); break;
      }
      case 'operation.undo': {
        if (operations.length !== 1) fail('CANVAS_INVALID_INPUT', 'Undo must be submitted alone');
        const previous = journal[op.operationId];
        if (!previous) fail('CANVAS_OPERATION_NOT_FOUND', 'Operation not found', 404);
        for (const [key, expected] of Object.entries(previous!.after)) {
          // Invert only the fields this operation changed. Later independent
          // changes survive; overwriting the same field is a real conflict.
          assertCanvasMerge(expected, previous!.before[key], next[key] ?? [], key);
          next[key] = mergeCanvasValue(expected, previous!.before[key], next[key] ?? []);
          touched.add(key);
        }
        previous!.receipt.nodeIds.forEach(id => nodeIds.add(id)); break;
      }
    }
  }
  return { state: next, keys: [...touched], nodeIds: [...nodeIds] };
}

/** Reject same-field, delete/edit and same-ID insert conflicts on legacy saves too. */
export function assertCanvasMerge(base: unknown, local: unknown, remote: unknown, location = ''): void {
  if (equal(base, local) || equal(base, remote) || equal(local, remote)) return;
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote)
    && [...base, ...local, ...remote].every(v => v && typeof v.id === 'string')) {
    const ids = new Set([...base, ...local, ...remote].map(v => v.id));
    for (const id of ids) assertCanvasMerge(base.find(v => v.id === id), local.find(v => v.id === id), remote.find(v => v.id === id), `${location}/${id}`);
    return;
  }
  if ([base, local, remote].every(v => v && typeof v === 'object' && !Array.isArray(v))) {
    const b = base as State, l = local as State, r = remote as State;
    for (const key of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) assertCanvasMerge(b[key], l[key], r[key], `${location}/${key}`);
    return;
  }
  throw new CanvasStateError(409, 'CANVAS_REVISION_CONFLICT', '画布内容已被修改，请保留草稿并重新读取', { field: location });
}
