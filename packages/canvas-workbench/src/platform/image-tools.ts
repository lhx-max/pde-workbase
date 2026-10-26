import type {ImageToolId} from '@ks-designai/image-card-pack/tool-contract';
import {getCanvasHostContext,platformFetchWithContext,projectFileUrl,type CanvasHostContext} from './api-base';
import {flushCanvasForProject} from './canvas-persistence';
import {uploadCanvasAttachment} from './canvas-file-upload';
export type ToolCapability={id:string;configured:boolean;reason?:string};
async function envelope<T>(context:CanvasHostContext,path:string,init?:RequestInit):Promise<T>{
 const response=await platformFetchWithContext(context,path,init);const value=await response.json().catch(()=>null) as {data?:T;error?:{message?:string}}|null;
 if(!response.ok||!value||value.error)throw Object.assign(Error(value?.error?.message??`图片工具请求失败（${response.status}）`),{definitive:response.status>=400&&response.status<500});
 return value.data as T;
}
function assertCurrent(context:CanvasHostContext){const current=getCanvasHostContext();if(current!==context)throw Error('画布实例已切换，请重新选择图片');}
const endpoint=(context:CanvasHostContext)=>`/api/apps/image/instances/${encodeURIComponent(context.projectId)}`;
export async function loadCanvasImageTools(context:CanvasHostContext):Promise<ToolCapability[]>{
 const value=await envelope<{tools:ToolCapability[]}>(context,`${endpoint(context)}/tools`);assertCurrent(context);
 if(!Array.isArray(value?.tools))throw Error('图片工具服务返回了无效能力清单');return value.tools;
}
export async function uploadImageToolInput(context:CanvasHostContext,file:File){
 assertCurrent(context);const resource=await uploadCanvasAttachment(file,context);assertCurrent(context);
 return{path:resource.path,url:projectFileUrl(resource.path,context)};
}
/** Versioned App action; never patch private image node data or call model endpoints from the browser. */
export async function runCanvasImageTool(context:CanvasHostContext,nodeId:string,kind:ImageToolId,params:Record<string,unknown>,signal:AbortSignal,key:string=crypto.randomUUID()){
 assertCurrent(context);await flushCanvasForProject(context.projectId);assertCurrent(context);signal.throwIfAborted();
 const state=await envelope<{revision:number}>(context,`${endpoint(context)}/state`,{signal});
 if(!Number.isSafeInteger(state.revision))throw Error('图片工作区版本不可用');
 type Receipt={receiptId:string;status:string;result?:{error?:string;tasks?:Array<{error?:{message?:string}}>}};
 const input={nodeId,kind,params};
 let receipt=await envelope<Receipt>(context,`${endpoint(context)}/actions/image.tool`,{method:'POST',headers:{'content-type':'application/json','idempotency-key':key},body:JSON.stringify({input,expectedRevision:state.revision}),signal});
 const notify=()=>window.dispatchEvent(new CustomEvent('bezier:canvas-text-delivery-changed',{detail:{projectId:context.projectId}}));notify();
 if(!receipt?.receiptId)throw Error('图片工具没有返回可追踪的任务回执');
 const started=Date.now();
 while(!['succeeded','failed'].includes(receipt.status)){
  assertCurrent(context);signal.throwIfAborted();
  if(Date.now()-started>15*60*1000)throw Error('图片任务仍在执行，可通过图片App任务回执继续查询；不会自动重新生成');
  await new Promise<void>((resolve,reject)=>{const finish=()=>{signal.removeEventListener('abort',abort);resolve();};const timer=setTimeout(finish,900);const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason??Error('查询已停止'));};signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
  receipt=await envelope<Receipt>(context,`${endpoint(context)}/action-receipts/${encodeURIComponent(receipt.receiptId)}`,{signal});notify();
 }
 assertCurrent(context);notify();
 if(receipt.status!=='succeeded')throw Object.assign(Error(receipt.result?.error??receipt.result?.tasks?.find(t=>t.error?.message)?.error?.message??'图片工具执行失败；原图已保留'),{definitive:true});
}

/** Preserve a logical operation key when transport outcome is unknown. A manual
 * retry can recover its existing receipt instead of charging for another job. */
export function createCanvasImageToolRunner(context:CanvasHostContext,nodeId:string,signal:()=>AbortSignal){
 let pending:{fingerprint:string;key:string}|undefined;
 return async(kind:ImageToolId,params:Record<string,unknown>)=>{
  const fingerprint=JSON.stringify([kind,params]);
  if(!pending||pending.fingerprint!==fingerprint)pending={fingerprint,key:crypto.randomUUID()};
  const operation=pending;
  try{await runCanvasImageTool(context,nodeId,kind,params,signal(),operation.key);if(pending===operation)pending=undefined;}
  catch(error){if((error as {definitive?:boolean})?.definitive&&pending===operation)pending=undefined;throw error;}
 };
}

export async function listCanvasImageToolCandidates(context:CanvasHostContext){
 const value=await envelope<{cards:Array<{nodeId:string;node?:{path?:string;name?:string}}> }>(context,`${endpoint(context)}/state`);assertCurrent(context);
 const paths=new Set<string>();return (value.cards??[]).flatMap(card=>{const path=card.node?.path;if(!path||!/[.](png|jpe?g|webp)$/iu.test(path)||paths.has(path))return[];paths.add(path);return[{id:card.nodeId,name:card.node?.name||path.split('/').at(-1)||'图片',path,url:projectFileUrl(path,context)}];});
}


/** Editable mockup document adapter. URL reconstruction belongs to the host;
 * durable documents contain authorized project paths only. */
export function createCanvasImageEditSession(context:CanvasHostContext,nodeId:string){
 let sourcePath:string|undefined;let editRevision=0;
 let pending:{fingerprint:string;key:string}|undefined;
 const read=async()=>{
  assertCurrent(context);
  const value=await envelope<{result:{sourcePath:string;editRevision:number;document:Record<string,any>|null}}>(context,`${endpoint(context)}/actions/image.edit.read`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({input:{nodeId}})});
  assertCurrent(context);return value.result;
 };
 return {
  async load(){
   const value=await read();sourcePath=value.sourcePath;editRevision=value.editRevision;
   if(!value.document)return null;
   const doc=value.document;
   return {version:2 as const,baseUrl:projectFileUrl(sourcePath,context),basePath:sourcePath,layers:doc.layers.map((layer:Record<string,any>)=>({...layer,url:projectFileUrl(layer.path,context)})),surface:doc.surface} as import('@ks-designai/image-card-pack/react').MockupEditState;
  },
  async save(value:unknown){
   assertCurrent(context);if(!sourcePath)throw Error('样机工程尚未加载，不能覆盖');
   const edit=value as {version:number;layers:Array<Record<string,unknown>>;surface:unknown};
   const document={version:2,basePath:sourcePath,layers:edit.layers.map(({url,...layer})=>layer),surface:edit.surface};
   const fingerprint=JSON.stringify(document);
   if(!pending||pending.fingerprint!==fingerprint)pending={fingerprint,key:crypto.randomUUID()};
   const operation=pending;
   await flushCanvasForProject(context.projectId);assertCurrent(context);
   const state=await envelope<{revision:number}>(context,`${endpoint(context)}/state`);
   try{
    const saved=await envelope<{result:{editRevision:number}}>(context,`${endpoint(context)}/actions/image.edit.save`,{method:'POST',headers:{'content-type':'application/json','idempotency-key':operation.key},body:JSON.stringify({input:{nodeId,document,expectedEditRevision:editRevision},expectedRevision:state.revision})});
    assertCurrent(context);editRevision=saved.result.editRevision;if(pending===operation)pending=undefined;
    window.dispatchEvent(new CustomEvent('bezier:canvas-text-delivery-changed',{detail:{projectId:context.projectId}}));
   }catch(error){if((error as {definitive?:boolean}).definitive&&pending===operation)pending=undefined;throw error;}
  }
 };
}
