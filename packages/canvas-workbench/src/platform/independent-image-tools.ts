import type {CanvasImageReference} from '@bezier/contracts';
import type {ImageToolId} from '@ks-designai/image-card-pack/tool-contract';
import {getCanvasHostContext,platformFetchWithContext,resolveCanvasImageSrc,type CanvasHostContext} from './api-base';
import {flushCanvasForProject} from './canvas-persistence';
import type {ToolCapability} from './image-tools';

type Asset={id:string;path:string;mime:string;sha256:string;width:number;height:number};
type State={workspace:{revision:number};assets:Asset[]};
type Job={id:string;status:string;outputAssetIds:string[]};
type Mutation<T>={receiptId:string;revision:number;result:T};
type Command={path:string;body:unknown;key:string};
const raster=new Set(['image/png','image/jpeg','image/webp']);
const definitive=(message:string)=>Object.assign(Error(message),{definitive:true});

/** Runtime adapter for immutable references. All bytes, uploads, masks and
 * results belong to Image; Canvas commits verified references in one batch. */
export function createIndependentImageToolSession(context:CanvasHostContext,_nodeId:string,reference:CanvasImageReference,position:{x:number;y:number},signal:()=>AbortSignal,isCurrent:()=>boolean=()=>true){
 const ref={...reference};
 const base=`/api/projects/${encodeURIComponent(context.projectId)}/image-app/${encodeURIComponent(ref.applicationInstanceId)}/api/apps/image`;
 const workspace=`${base}/instances/${encodeURIComponent(ref.workspaceId)}`;
 const current=()=>{signal().throwIfAborted();if(getCanvasHostContext()!==context||!isCurrent())throw Error('画布实例已切换，请重新选择图片');};
 async function json<T>(path:string,init?:RequestInit,enveloped=true):Promise<T>{
  current();const response=await platformFetchWithContext(context,path,{...init,signal:signal()});current();
  const value=await response.json().catch(()=>null);current();
  if(!response.ok||!value||value.error)throw Object.assign(Error(value?.error?.message??`生图请求失败（${response.status}）`),{definitive:response.status>=400&&response.status<500});
  return (enveloped?value.data:value) as T;
 }
 const state=async()=>{
  const value=await json<State>(`${workspace}/state`);
  const source=value.assets?.find(asset=>asset.id===ref.assetId);
  if(!source||source.sha256!==ref.sha256||source.mime!==ref.mime||source.width!==ref.width||source.height!==ref.height)throw definitive('原图引用已失效，请重新选择图片');
  if(!Number.isSafeInteger(value.workspace?.revision))throw Error('生图工作区版本不可用');
  return value;
 };
 const command=<T>(input:Command)=>json<T>(input.path,{method:'POST',headers:{'content-type':'application/json','idempotency-key':input.key},body:JSON.stringify(input.body)});
 const notify=()=>window.dispatchEvent(new CustomEvent('bezier:canvas-text-delivery-changed',{detail:{projectId:context.projectId}}));
 type Batch={command?:Command};
 async function attach(ids:string[],batch:Batch){
  if(!ids.length||ids.length>9||new Set(ids).size!==ids.length)throw definitive('生图没有返回完整的可引用图片批次');
  const owned=await state();
  if(ids.some(id=>!owned.assets.some(a=>a.id===id&&raster.has(a.mime))))throw definitive('生图产物尚未就绪，未向画布写入部分结果');
  if(!batch.command){
   await flushCanvasForProject(context.projectId);current();
   const canvas=await json<{revision:number}>(`/api/projects/${encodeURIComponent(context.projectId)}/canvas/state`,undefined,false);
   if(!Number.isSafeInteger(canvas.revision))throw Error('画布版本不可用');
   batch.command={path:`/api/projects/${encodeURIComponent(context.projectId)}/image-app/reference-batches`,key:crypto.randomUUID(),body:{applicationInstanceId:ref.applicationInstanceId,workspaceId:ref.workspaceId,assets:ids.map((assetId,index)=>({assetId,x:position.x+460+(index%3)*440,y:position.y+Math.floor(index/3)*400})),expectedRevision:canvas.revision}};
  }
  try{await command(batch.command);current();notify();}catch(error){if((error as {definitive?:boolean}).definitive)batch.command=undefined;throw error;}
 }
 const uploads=new Map<string,{command:Command;asset?:Asset}>();
 async function upload(file:File,slot='input'){
  current();if(!raster.has(file.type)||file.size<=0||file.size>5*1024*1024)throw definitive('工具输入须为5MiB以内的PNG/JPEG/WebP图片');
  const bytes=new Uint8Array(await file.arrayBuffer());current();
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');current();
  const fingerprint=`${file.type}:${slot}:${hash}`;let operation=uploads.get(fingerprint);
  if(!operation){
   const snapshot=await state();const chunks:string[]=[];for(let i=0;i<bytes.length;i+=32768)chunks.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
   const ext=file.type==='image/jpeg'?'jpg':file.type==='image/webp'?'webp':'png';
   operation={command:{path:`${workspace}/assets`,key:crypto.randomUUID(),body:{input:{path:`inputs/${hash}-${slot}.${ext}`,mime:file.type,role:'original',contentBase64:btoa(chunks.join(''))},expectedRevision:snapshot.workspace.revision}}};uploads.set(fingerprint,operation);
  }
  if(!operation.asset){try{operation.asset=(await command<Mutation<Asset>>(operation.command)).result;}catch(error){if((error as {definitive?:boolean}).definitive)uploads.delete(fingerprint);throw error;}}
  const asset=operation.asset;if(!asset?.id||asset.sha256!==hash||asset.mime!==file.type)throw Error('生图输入回执不完整');
  return {path:asset.path,url:resolveCanvasImageSrc(`${workspace}/assets/${encodeURIComponent(asset.id)}`),assetId:asset.id};
 }
 let pending:{fingerprint:string;command:Command;job?:Job;batch:Batch}|undefined;
 const derivedBatches=new Map<string,Batch>();
 return {
  async loadCapabilities():Promise<ToolCapability[]>{const result=await json<{tools:ToolCapability[]}>(`${base}/capabilities`);if(!Array.isArray(result.tools))throw Error('生图工具能力清单无效');return result.tools;},
  upload,
  async createImages(images:Array<{file:File;width:number;height:number}>){
   if(!images.length||images.length>9)throw definitive('派生图片数量须为1至9张');
   // Upload the entire batch before committing a single Canvas reference.
   const ids:string[]=[];for(const [index,image] of images.entries()){current();ids.push((await upload(image.file,`derived-${index}`)).assetId);}
   const fingerprint=ids.join(':');let batch=derivedBatches.get(fingerprint);if(!batch){batch={};derivedBatches.set(fingerprint,batch);}
   await attach(ids,batch);derivedBatches.delete(fingerprint);
  },
  async run(kind:ImageToolId,params:Record<string,unknown>){
   current();const fingerprint=JSON.stringify([kind,params]);
   if(pending&&pending.fingerprint!==fingerprint)throw Error('上次任务结果尚未确认，请先重试原操作或在生图App查询回执');
   if(!pending){const snapshot=await state();const source=snapshot.assets.find(a=>a.id===ref.assetId)!;pending={fingerprint,command:{path:`${workspace}/actions/image.tool`,key:crypto.randomUUID(),body:{input:{sourceAssetId:ref.assetId,tool:{kind,source:source.path,params}},expectedRevision:snapshot.workspace.revision}},batch:{}};}
   const operation=pending;
   try{
    if(!operation.job)operation.job=(await command<Mutation<Job>>(operation.command)).result;
    if(!operation.job?.id)throw Error('生图没有返回可追踪的任务回执');
    const started=Date.now();while(!['done','failed','cancelled','interrupted'].includes(operation.job.status)){
     current();if(Date.now()-started>15*60*1000)throw Error('任务仍在执行，请稍后查询原回执，不会重新生成');
     await new Promise<void>((resolve,reject)=>{const active=signal();const stop=()=>{clearTimeout(timer);active.removeEventListener('abort',stop);reject(active.reason??Error('查询已停止'));};const timer=setTimeout(()=>{active.removeEventListener('abort',stop);resolve();},900);active.addEventListener('abort',stop,{once:true});if(active.aborted)stop();});
     operation.job=await json<Job>(`${workspace}/jobs/${encodeURIComponent(operation.job.id)}`);
    }
    if(operation.job.status!=='done'){pending=undefined;throw definitive('生图任务未完成；原图已保留，可在生图App查询任务详情');}
    const owned=await state();if(!Array.isArray(operation.job.outputAssetIds)||operation.job.outputAssetIds.some(id=>!owned.assets.some(a=>a.id===id)))throw Error('生图返回了缺失的批次产物，未向画布写入部分结果');const ids=operation.job.outputAssetIds.filter(id=>owned.assets.some(a=>a.id===id&&raster.has(a.mime)&&a.mime!=='application/json'));
    await attach(ids,operation.batch);if(pending===operation)pending=undefined;
   }catch(error){if(!operation.job&&(error as {definitive?:boolean}).definitive)pending=undefined;throw error;}
  },
 };
}
