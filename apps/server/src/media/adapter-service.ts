import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import type {MediaTaskGenerationMetadata, ProjectFile} from '@bezier/contracts';
import type {Database} from '../storage/database.js';
import type {ProjectRegistry} from '../storage/project-registry.js';
import type {CanvasStateService} from '../canvas/state.js';
import {MediaCanvasDelivery} from './canvas-delivery.js';
import {MediaScheduler} from './scheduler.js';
import {acceptMediaRequest} from './request-identity.js';
import {getMediaTask,insertMediaTask,updateMediaTask,listMediaTasksByProject,migrateMediaTasks,reconcileMediaTasksOnBoot,type MediaTaskRow} from './tasks.js';
import {writeProjectFile,readProjectFile} from '../projects.js';
import sharp from 'sharp';
import {recordProjectLedgerObservation} from '../project-ledger/active-recorder.js';
export interface MediaCatalog {
 providers:Array<{id:string;label?:string;integrated?:boolean;capabilities?:string[]}>;
 image:Array<{id:string;label:string;provider:string;caps:string[]}>;
 video:Array<{id:string;label:string;provider:string;caps:string[]}>;
 audio:Record<string,unknown[]>;aspects:string[];videoLengthsSec:number[];audioDurationsSec:number[];
}
export interface MediaAdapter {
 catalog():Promise<MediaCatalog>;
 config():Promise<{providers:Record<string,{configured?:boolean;model?:string}>}>;
 configure?(value:unknown):Promise<unknown>;
 generate(input:{taskId:string;projectId:string;request:Record<string,unknown>;inputs:Array<{path:string;content:Uint8Array;mime:string}>;signal:AbortSignal;onProgress:(line:string)=>void}):Promise<{path:string;content:Uint8Array;mime:string}>;
}
/** Original media metadata normalization, independent of provider/product configuration. */
export function mediaTaskGenerationMetadata(body:Record<string,any>):MediaTaskGenerationMetadata {
 const slot=body?.slot,lineage=body?.lineage;
 const normalizedLineage:NonNullable<MediaTaskGenerationMetadata['lineage']>={
 ...(Array.isArray(lineage?.sourceNodeIds)?{sourceNodeIds:lineage.sourceNodeIds.filter((id:unknown):id is string=>typeof id==='string'&&id.length>0)}:{}),
 ...(typeof lineage?.sourceTaskId==='string'?{sourceTaskId:lineage.sourceTaskId}:{}),...(typeof lineage?.sourceAssetPath==='string'?{sourceAssetPath:lineage.sourceAssetPath}:{}),
 ...(typeof lineage?.sourceRevision==='string'||typeof lineage?.sourceRevision==='number'?{sourceRevision:lineage.sourceRevision}:{})};
 return {...(body.operation==='cutout'?{operation:'cutout' as const}:{}),...(typeof body.prompt==='string'?{prompt:body.prompt}:{}),...(typeof body.aspect==='string'?{aspect:body.aspect}:{}),...(typeof body.quality==='string'?{quality:body.quality}:{}),...(typeof body.resolution==='string'?{resolution:body.resolution}:{}),
 ...(slot&&typeof slot==='object'&&!Array.isArray(slot)&&typeof slot.id==='string'?{slot:{id:slot.id,...(typeof slot.kind==='string'?{kind:slot.kind}:{}),...(typeof slot.label==='string'?{label:slot.label}:{})}}:{}),
 ...(lineage&&typeof lineage==='object'&&!Array.isArray(lineage)&&Object.keys(normalizedLineage).length?{lineage:normalizedLineage}:{})};
}
export class MediaAdapterService {
 readonly delivery:MediaCanvasDelivery;
 private readonly scheduler=new MediaScheduler();private readonly active=new Map<string,AbortController>();private readonly changes=new EventEmitter();private readonly jobs=new Set<Promise<unknown>>();
 constructor(private readonly db:Database,private readonly registry:ProjectRegistry,canvas:CanvasStateService,readonly adapter?:MediaAdapter){
  migrateMediaTasks(db);this.delivery=new MediaCanvasDelivery(db,canvas,id=>registry.get(id)?registry.resolveProjectRoot(id):null);
  db.exec('CREATE TABLE IF NOT EXISTS media_adapter_requests(task_id TEXT PRIMARY KEY REFERENCES media_tasks(id) ON DELETE CASCADE, request_json TEXT NOT NULL)');
  reconcileMediaTasksOnBoot(db,{terminalTtlMs:24*60*60*1000});
 }
 async ready(){await this.delivery.reconcile();}
 snapshot(task:MediaTaskRow){return {canvasDelivery:this.delivery.receipt(task.id),taskId:task.id,status:task.status,startedAt:task.startedAt,endedAt:task.endedAt,elapsed:Math.round(((task.endedAt??Date.now())-task.startedAt)/1000),surface:task.surface,model:task.model,...mediaTaskGenerationMetadata(task),progress:task.progress.slice(-3),progressCount:task.progress.length,...(task.status==='done'?{file:task.file}:{}),...(['failed','interrupted'].includes(task.status)?{error:task.error}:{})};}
 get(id:string){return getMediaTask(this.db,id);}
 list(projectId:string,includeTerminal:boolean,taskIds?:string[]){return listMediaTasksByProject(this.db,projectId,{includeTerminal,...(taskIds?{taskIds}:{})}).map(task=>this.snapshot(task));}
 async submit(projectId:string,request:Record<string,unknown>){
  if(!this.registry.get(projectId))throw Object.assign(new Error('project not found'),{status:404,code:'PROJECT_NOT_FOUND'});
  if(!this.adapter)throw Object.assign(new Error('No media adapter configured'),{status:503,code:'MEDIA_ADAPTER_UNAVAILABLE'});
  const surface=request.surface;if(!['image','video','audio'].includes(String(surface)))throw new Error('invalid media surface');
  if(typeof request.model!=='string'||!request.model)throw new Error('model is required');
  const catalog=await this.adapter.catalog();const models=surface==='image'?catalog.image:surface==='video'?catalog.video:Object.values(catalog.audio).flat();
  if(!models.some(model=>model&&typeof model==='object'&&'id' in model&&model.id===request.model))throw new Error('media model is not exposed by the configured adapter');
  if(request.canvasDelivery&&!/^[a-f0-9-]{36}$/i.test(String(request.clientRequestId??'')))throw new Error('canvas delivery requires a UUID clientRequestId');
  this.db.prepare('INSERT OR IGNORE INTO projects(id) VALUES (?)').run(projectId);
  const taskId=request.canvasDelivery?`canvas-${request.clientRequestId}`:randomUUID();
  const accepted=acceptMediaRequest(this.db,projectId,request,()=>{
   const task=insertMediaTask(this.db,{id:taskId,projectId,surface:String(surface),model:String(request.model),...mediaTaskGenerationMetadata(request)});
   this.db.prepare('INSERT INTO media_adapter_requests(task_id,request_json) VALUES (?,?)').run(task.id,JSON.stringify(request));return task;
  });
  const task=accepted.created??this.get(accepted.taskId)!;
  if(!accepted.created)return {...this.snapshot(task),reused:true,canvasDeliveryOwned:Boolean(request.canvasDelivery)};
  try{if(request.canvasDelivery)await this.delivery.accept(task,request);}catch(error){updateMediaTask(this.db,task.id,{status:'failed',endedAt:Date.now(),error:{message:String(error),code:'DELIVERY_TARGET_INVALID'}});throw error;}
  const abort=new AbortController();this.active.set(task.id,abort);
  const progress=(line:string)=>{const current=this.get(task.id);if(!current||abort.signal.aborted)return;updateMediaTask(this.db,task.id,{progress:[...current.progress,line]});void this.delivery.settle(task.id);this.changes.emit(task.id);};
  const job=this.scheduler.run(async()=>{
   if(abort.signal.aborted)throw new Error('Cancelled before provider dispatch');
   if(request.canvasDelivery)await this.delivery.assertPendingTarget(task.id);
   updateMediaTask(this.db,task.id,{status:'running'});progress('正在执行媒体生成');
   const references=[...new Set([request.image,...(Array.isArray(request.images)?request.images:[])].filter((value):value is string=>typeof value==='string'&&value.length>0&&!/^(?:https?:|data:)/.test(value)))];
   if(references.length>32)throw new Error('At most 32 input files are allowed');
   const inputs:Array<{path:string;content:Uint8Array;mime:string}>=[];let inputBytes=0;
   for(const name of references){const file=await readProjectFile(this.registry.projectsRoot,projectId,name,this.registry.get(projectId)?.metadata);inputBytes+=file.size;if(inputBytes>50*1024*1024)throw new Error('Media input files exceed 50 MB');inputs.push({path:file.name,content:file.buffer,mime:file.mime});}
   const result=await this.adapter!.generate({taskId:task.id,projectId,request,inputs,signal:abort.signal,onProgress:progress});
   if(abort.signal.aborted)return;
   if(!result.content.byteLength||result.content.byteLength>1024*1024*1024)throw new Error('Invalid or oversized media output');
   if(!result.mime.startsWith(`${surface}/`))throw new Error('Media output MIME does not match requested surface');
   if(surface==='image')await sharp(result.content).metadata();
   if(typeof request.output==='string'&&result.path!==request.output)throw new Error('Media output differs from declared project path');
   const file=await writeProjectFile(this.registry.projectsRoot,projectId,result.path,Buffer.from(result.content),{overwrite:false},this.registry.get(projectId)?.metadata);
   updateMediaTask(this.db,task.id,{status:'done',file,endedAt:Date.now()});
  },()=>progress('等待媒体执行名额，尚未提交供应商')).catch(error=>{if(!abort.signal.aborted)updateMediaTask(this.db,task.id,{status:'failed',error:{message:error instanceof Error?error.message:String(error),code:'MEDIA_GENERATION_FAILED'},endedAt:Date.now()});}).finally(async()=>{
   this.active.delete(task.id);await this.delivery.settle(task.id);const final=this.get(task.id)!;this.changes.emit(task.id);
   recordProjectLedgerObservation({projectId,type:`media.task.${final.status}`,source:'media-adapter',entityType:'media_task',entityId:task.id,correlationId:task.id,summary:final.error?.message??'Media task completed',payload:{surface,model:request.model,file:final.file},idempotencyKey:`media:${task.id}:${final.status}`});
  });
  this.jobs.add(job);void job.finally(()=>this.jobs.delete(job)).catch(error=>console.error('Media delivery reconciliation failed',error));
  return {...this.snapshot(task),canvasDeliveryOwned:Boolean(request.canvasDelivery)};
 }
 async cancel(id:string){const task=this.get(id);if(!task)return null;if(['queued','running'].includes(task.status)){this.active.get(id)?.abort();updateMediaTask(this.db,id,{status:'interrupted',error:{code:'CANCELLED',message:'Cancellation requested; no output will be published'},endedAt:Date.now()});await this.delivery.settle(id);this.changes.emit(id);}return this.snapshot(this.get(id)!);}
 async retry(id:string){const task=this.get(id);if(!task)throw new Error('task not found');if(['queued','running'].includes(task.status))throw new Error('task is still running');const row=this.db.prepare('SELECT request_json AS request FROM media_adapter_requests WHERE task_id=?').get(id) as {request:string}|undefined;if(!row)throw new Error('Original request is unavailable; submit a new request');const request=JSON.parse(row.request) as Record<string,unknown>;return this.submit(task.projectId,{...request,clientRequestId:randomUUID(),...(typeof request.output==='string'?{output:request.output.replace(/(\.[^./]+)$/u,`-${randomUUID()}$1`)}:{})});}
 wait(id:string,signal:AbortSignal):Promise<ReturnType<MediaAdapterService['snapshot']>|null>{const current=this.get(id);if(!current)return Promise.resolve(null);if(!['queued','running'].includes(current.status))return Promise.resolve(this.snapshot(current));return new Promise(resolve=>{const done=()=>{this.changes.off(id,changed);signal.removeEventListener('abort',done);const task=this.get(id);resolve(task?this.snapshot(task):null);};const changed=()=>{const task=this.get(id);if(!task||!['queued','running'].includes(task.status))done();};this.changes.on(id,changed);signal.addEventListener('abort',done,{once:true});if(signal.aborted)done();});}
 async close(){this.scheduler.close();for(const id of this.active.keys())await this.cancel(id);await Promise.allSettled(this.jobs);}
}
