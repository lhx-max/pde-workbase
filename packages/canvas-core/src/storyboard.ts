import type { CanvasOperation } from '@bezier/contracts';
import type { CanvasItem } from './assets.js';
import { CanvasStateError } from './errors.js';

export type StoryboardOperation = Extract<CanvasOperation, {type:`storyboard.${string}`}>;
const fail = (message:string):never => { throw new CanvasStateError(400,'CANVAS_INVALID_STORYBOARD',message); };
export function blankStoryboard(shotId:string) {
  return {version:1,aspectRatio:'16:9',visualStyle:'',referenceRoles:{},shots:[blankShot(shotId)]};
}
function blankShot(id:string):CanvasItem {
  return {id,description:'',shotSize:'中景',cameraMovement:'固定',durationSec:4,dialogue:''};
}
export function cloneAuthoredShot(shot:CanvasItem,id:string):CanvasItem {
  const {imageNodeId:_image,videoNodeId:_video,selectedImagePath:_selected,imageSources:_sources,imageInputSignature:_signature,
    imageNodeHistoryIds:_history,imageAssetRevisions:_revisions,tailFrame,...authored}=shot;
  return {...structuredClone(authored),id,...(tailFrame && typeof tailFrame==='object' ? {tailFrame:cloneAuthoredFrame(tailFrame as Record<string,unknown>)} : {})};
}
function cloneAuthoredFrame(frame:Record<string,unknown>):Record<string,unknown> {
  const {imageNodeId:_image,videoNodeId:_video,selectedImagePath:_selected,imageSources:_sources,imageInputSignature:_signature,
    imageNodeHistoryIds:_history,imageAssetRevisions:_revisions,...authored}=frame;
  return structuredClone(authored);
}
export function hasStoryboardGeneratedReferences(value:unknown):boolean {
  if(!value || typeof value!=='object')return false;
  const node=value as Record<string,unknown>;
  return ['imageNodeId','videoNodeId'].some(key=>typeof node[key]==='string' && Boolean(node[key]))
    || (Array.isArray(node.imageNodeHistoryIds) && node.imageNodeHistoryIds.some(id=>typeof id==='string' && Boolean(id)))
    || hasStoryboardGeneratedReferences(node.tailFrame)
    || (Array.isArray(node.shots) && node.shots.some(hasStoryboardGeneratedReferences));
}
export function applyStoryboardOperation(node:CanvasItem,op:StoryboardOperation, assets:CanvasItem[] = []):CanvasItem {
  if(node.kind!=='storyboard') throw new CanvasStateError(400,'CANVAS_OPERATION_UNSUPPORTED','Target is not a storyboard');
  const plan=structuredClone(node.storyboard) as Record<string,unknown>|undefined;
  if(!plan || !Array.isArray(plan.shots)) return fail('Storyboard has no editable plan');
  const shots=plan.shots as CanvasItem[];
  const index=shots.findIndex(s=>s.id===op.shotId),shot=shots[index];
  if(op.type!=='storyboard.shot.add' && !shot) throw new CanvasStateError(404,'CANVAS_SHOT_NOT_FOUND','Shot not found');
  if(op.type==='storyboard.shot.add' || op.type==='storyboard.shot.duplicate') {
    if(shots.length>=50) return fail('Storyboard supports at most 50 shots');
    const id=op.type==='storyboard.shot.add'?op.shotId:op.newShotId;
    if(shots.some(s=>s.id===id)) throw new CanvasStateError(409,'CANVAS_ID_EXISTS','Shot ID already exists');
    if(op.type==='storyboard.shot.add') {
      if(op.index!==undefined && op.index>shots.length) return fail('Index exceeds shot count');
      shots.splice(op.index??shots.length,0,{...blankShot(id),...op.set});
    } else shots.splice(index+1,0,cloneAuthoredShot(shot!,id));
  } else if (op.type==='storyboard.shot.references') {
    const assertRef=(ref:{assetId:string;variantId?:string|undefined},kind:string)=>{
      const asset=assets.find(a=>a.id===ref.assetId && a.kind===kind && (!a.ownerStoryboardId || a.ownerStoryboardId===node.id));
      if(!asset || (ref.variantId && (!Array.isArray(asset.variants) || !asset.variants.some(v=>v.id===ref.variantId))))
        throw new CanvasStateError(400,'CANVAS_INVALID_STORYBOARD_REFERENCE','Asset or variant is unavailable for this storyboard');
    };
    op.characters.forEach(ref=>assertRef(ref,'character'));
    if(op.scene) assertRef(op.scene,'scene');
    const {scene:_scene,...remaining}=shot!;
    shots[index]={...remaining,characters:op.characters,...(op.scene?{scene:op.scene}:{})};
  } else if(op.type==='storyboard.shot.update') shots[index]={...shot!,...op.set};
  else if(op.type==='storyboard.shot.move') {
    if(op.index>=shots.length) return fail('Index exceeds shot count');
    shots.splice(index,1);shots.splice(op.index,0,shot!);
  } else {
    if(shots.length===1) return fail('Keep at least one shot');
    if(hasStoryboardGeneratedReferences(shot))
      throw new CanvasStateError(400,'CANVAS_OPERATION_UNSUPPORTED','Detach generated cards before deleting a shot');
    shots.splice(index,1);
  }
  return {...node,storyboard:plan};
}
