import type { CanvasOperation } from '@bezier/contracts';
import type { CanvasItem } from './assets.js';
import { CanvasStateError } from './errors.js';

export type VideoOperation = Extract<CanvasOperation,{type:'video.attach'|'video.select'}>;
export interface CanvasVideoStore { assertVideo(path:string):Promise<void> }
export async function prepareCanvasVideo(store:CanvasVideoStore,operationId:string,op:VideoOperation,current?:CanvasItem):Promise<CanvasItem> {
  if(!current || current.kind!=='video') throw new CanvasStateError(400,'CANVAS_OPERATION_UNSUPPORTED','Target is not a video');
  if(op.expectedPath!==undefined && (current.projectFilePath||'')!==op.expectedPath)
    throw new CanvasStateError(409,'CANVAS_REVISION_CONFLICT','Video selection changed');
  if((current.videoTask as {status?:string}|undefined)?.status==='running' || (current.mediaDelivery as {status?:string}|undefined)?.status==='pending')
    throw new CanvasStateError(409,'CANVAS_VIDEO_BUSY','Wait for or cancel the current generation before replacing its output');
  const history=Array.isArray(current.videoResults)?current.videoResults as CanvasItem[]:[];
  const result=op.type==='video.select'?history.find(r=>r.id===op.resultId):undefined;
  if(op.type==='video.select' && (!result || typeof result.path!=='string'))
    throw new CanvasStateError(404,'CANVAS_VIDEO_RESULT_NOT_FOUND','Result is not in this card history');
  const path=op.type==='video.attach'?op.path:String(result!.path);
  await store.assertVideo(path);
  let id=op.type==='video.attach'?operationId:op.resultId;
  if (op.type === 'video.attach') {
    // A batch can attach several files to one card. Keep the first historical
    // ID compatible while assigning each subsequent result its own identity.
    const usedIds = new Set(history.map(result => result.id));
    for (let suffix = 1; usedIds.has(id); suffix++) {
      const ending = `-${suffix}`;
      id = `${operationId.slice(0, 160 - ending.length)}${ending}`;
    }
  }
  return {...current,projectFilePath:path,sourceMime:'video/mp4',activeVideoResultId:id,videoTask:undefined,
    videoResults:op.type==='video.attach'?[...history,{id,path,createdAt:Date.now()}]:history};
}
