import {validateTool,toolReferences} from '@ks-designai/image-card-pack/server';
import {createHash, randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import type {MediaTaskGenerationMetadata, ProjectFile} from '@bezier/contracts';
import type {JsonStatePort} from '@ks-designai/app-cloud-state';
import type {Database} from '../storage/database.js';
import type {ProjectRegistry} from '../storage/project-registry.js';
import type {CanvasStateService} from '../canvas/state.js';
import {MediaCanvasDelivery} from './canvas-delivery.js';
import {MediaScheduler} from './scheduler.js';
import {acceptMediaRequest,verifiedCallerScope} from './request-identity.js';
import {getMediaTask,insertMediaTask,updateMediaTask,listMediaTasksByProject,migrateMediaTasks,reconcileMediaTasksOnBoot,type MediaTaskRow} from './tasks.js';
import {MediaTaskJournal,sanitizeMediaJournalRequest} from './cloud-task-journal.js';
import {ToolDeliveryJournal,deliveredOutputs,parseToolResultPayload,planToolDelivery,type ToolArtifactStoragePort,type ToolResultPayload} from './tool-delivery.js';
import {writeProjectFile,readProjectFile} from '../projects.js';
import sharp from 'sharp';
import type { ImageFileStorage } from '../storage/cloud-image-files.js';
import {recordProjectLedgerObservation} from '../project-ledger/active-recorder.js';
export interface MediaCatalog {
 providers:Array<{id:string;label?:string;integrated?:boolean;capabilities?:string[]}>;
 image:Array<{id:string;label:string;provider:string;caps:string[]}>;
 video:Array<{id:string;label:string;provider:string;caps:string[]}>;
 audio:Record<string,unknown[]>;aspects:string[];videoLengthsSec:number[];audioDurationsSec:number[];
}
export interface MediaAdapter {
 identityMode?:'verified-request'|'service-only'|'single-user-development';
 catalog():Promise<MediaCatalog>;
 config():Promise<{providers:Record<string,{configured?:boolean;model?:string}>}>;
 configure?(value:unknown):Promise<unknown>;
 /** Static tool capability metadata; absence means the adapter exposes none. */
 tools?():Promise<Record<string,unknown>>;
 /** Tool requests may return a complete multi-artifact result: the primary
  * artifact stays the single-output contract and toolResult carries every
  * artifact's real bytes plus bounded JSON edit metadata. */
 generate(input:{taskId:string;projectId:string;request:Record<string,unknown>;inputs:Array<{path:string;content:Uint8Array;mime:string}>;signal:AbortSignal;onProgress:(line:string)=>void}):Promise<{path:string;content:Uint8Array;mime:string;toolResult?:ToolResultPayload}>;
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
 private readonly journal:MediaTaskJournal|null;
 private readonly toolJournal:ToolDeliveryJournal|undefined;
 private readonly toolArtifacts:ToolArtifactStoragePort|undefined;
 private cloudReady:Promise<void>|null=null;
 constructor(private readonly db:Database,private readonly registry:ProjectRegistry,private readonly canvas:CanvasStateService,readonly adapter?:MediaAdapter,private readonly imageFiles?:ImageFileStorage,options?:{state?:JsonStatePort;toolArtifacts?:ToolArtifactStoragePort}){
  migrateMediaTasks(db);this.delivery=new MediaCanvasDelivery(db,canvas,id=>registry.get(id)?registry.resolveProjectRoot(id):null,imageFiles);
  db.exec('CREATE TABLE IF NOT EXISTS media_adapter_requests(task_id TEXT PRIMARY KEY REFERENCES media_tasks(id) ON DELETE CASCADE, request_json TEXT NOT NULL)');
  this.journal=options?.state?new MediaTaskJournal(db,options.state):null;
  this.toolJournal=options?.state?new ToolDeliveryJournal(options.state):undefined;
  this.toolArtifacts=options?.toolArtifacts;
  // Cloud restore owns boot reconciliation; local mode keeps the historical synchronous pass.
  if(!this.journal)reconcileMediaTasksOnBoot(db,{terminalTtlMs:24*60*60*1000});
 }
 async ready():Promise<void>{
  if(!this.journal){await this.delivery.reconcile();return;}
  // Restore + boot reconciliation run exactly once; delivery settlement keeps
  // the historical per-call retry semantics afterwards.
  this.cloudReady??=(async()=>{
   const journal=this.journal!;
   await journal.restore();
   reconcileMediaTasksOnBoot(this.db,{terminalTtlMs:24*60*60*1000});
   await journal.persist();
  })();
  await this.cloudReady;
  await this.delivery.reconcile();
  await this.journal!.persist();
 }
 private persist():Promise<void>{return this.journal?this.journal.persist():Promise.resolve();}
 private async checkpoint(task:MediaTaskRow){
  if(!this.imageFiles||task.surface!=='image')return;
  const snapshot=this.snapshot(task);
  await this.canvas.updateMediaState(task.projectId,state=>({...state,workbenchImageTasks:{
   ...(state.workbenchImageTasks&&typeof state.workbenchImageTasks==='object'?state.workbenchImageTasks:{}),
   [task.id]:snapshot,
  }}));
 }
 snapshot(task:MediaTaskRow){return {canvasDelivery:this.delivery.receipt(task.id),taskId:task.id,status:task.status,startedAt:task.startedAt,endedAt:task.endedAt,elapsed:Math.round(((task.endedAt??Date.now())-task.startedAt)/1000),surface:task.surface,model:task.model,...mediaTaskGenerationMetadata(task),progress:task.progress.slice(-3),progressCount:task.progress.length,...(task.status==='done'?{file:task.file}:{}),...(['failed','interrupted'].includes(task.status)?{error:task.error}:{})};}
 get(id:string){this.journal?.assertHealthy();return getMediaTask(this.db,id);}
 list(projectId:string,includeTerminal:boolean,taskIds?:string[]){this.journal?.assertHealthy();return listMediaTasksByProject(this.db,projectId,{includeTerminal,...(taskIds?{taskIds}:{})}).map(task=>this.snapshot(task));}
 async submit(projectId:string,request:Record<string,unknown>){
  if(verifiedCallerScope()&&request.clientRequestId===undefined)throw Object.assign(new Error('Verified media generation requires a stable clientRequestId'),{status:428,code:'MEDIA_IDEMPOTENCY_REQUIRED'});
  if(this.journal){await this.ready();this.journal.assertHealthy();}
  if(!this.registry.get(projectId))throw Object.assign(new Error('project not found'),{status:404,code:'PROJECT_NOT_FOUND'});
  if(!this.adapter)throw Object.assign(new Error('No media adapter configured'),{status:503,code:'MEDIA_ADAPTER_UNAVAILABLE'});
  const surface=request.surface;if(this.journal&&surface!=='image')throw Object.assign(new Error('Cloud media persistence currently supports image outputs only'),{status:503,code:'MEDIA_CLOUD_SURFACE_UNAVAILABLE'});if(!['image','video','audio'].includes(String(surface)))throw new Error('invalid media surface');
  if(typeof request.model!=='string'||!request.model)throw new Error('model is required');
  const catalog=await this.adapter.catalog();const models=surface==='image'?catalog.image:surface==='video'?catalog.video:Object.values(catalog.audio).flat();
  if(!models.some(model=>model&&typeof model==='object'&&'id' in model&&model.id===request.model))throw new Error('media model is not exposed by the configured adapter');
  if(request.canvasDelivery&&!/^[a-f0-9-]{36}$/i.test(String(request.clientRequestId??'')))throw new Error('canvas delivery requires a UUID clientRequestId');
  if(request.tool!==undefined){
   const tool=validateTool(request.tool);
   if(surface!=='image')throw Object.assign(new Error('Image tools require the image surface'),{status:409,code:'IMAGE_TOOL_SURFACE_INVALID'});
   // JSON-primary tools have no image job adapter yet; fail explicitly rather
   // than faking a PNG or routing edit JSON through the image channel.
   if(tool.kind==='mockup-surface')throw Object.assign(new Error('JSON-only mockup surface requires a non-image job adapter'),{status:503,code:'IMAGE_TOOL_ADAPTER_UNAVAILABLE'});
   request={...request,tool,images:toolReferences(tool)};
  }
  // Credential-shaped fields must fail before any paid dispatch or durable write.
  const journalRequest=this.journal?sanitizeMediaJournalRequest(request):request;
  this.db.prepare('INSERT OR IGNORE INTO projects(id) VALUES (?)').run(projectId);
  const taskId=request.canvasDelivery?`canvas-${request.clientRequestId}`:randomUUID();
  const accepted=acceptMediaRequest(this.db,projectId,request,()=>{
   const task=insertMediaTask(this.db,{id:taskId,projectId,surface:String(surface),model:String(request.model),...mediaTaskGenerationMetadata(request)});
   this.db.prepare('INSERT INTO media_adapter_requests(task_id,request_json) VALUES (?,?)').run(task.id,JSON.stringify(journalRequest));return task;
  },taskId);
  const task=accepted.created??this.get(accepted.taskId)!;
  if(!accepted.created)return {...this.snapshot(task),reused:true,canvasDeliveryOwned:Boolean(request.canvasDelivery)};
  await this.checkpoint(task);
  try{if(request.canvasDelivery)await this.delivery.accept(task,request);}catch(error){updateMediaTask(this.db,task.id,{status:'failed',endedAt:Date.now(),error:{message:String(error),code:'DELIVERY_TARGET_INVALID'}});await this.persist().catch(()=>{});throw error;}
  // The accepted request must be durable before it reaches the scheduler or the provider.
  await this.persist();
  const abort=new AbortController();this.active.set(task.id,abort);
  const failDurable=(error:unknown)=>{
   const failure=error instanceof Error?error:new Error(String(error));abort.abort(failure);
   const current=getMediaTask(this.db,task.id);
   if(current&&['queued','running'].includes(current.status))updateMediaTask(this.db,task.id,{status:'failed',error:{message:`Media task journal is no longer durable; provider work aborted: ${failure.message}`,code:'MEDIA_JOURNAL_UNAVAILABLE'},endedAt:Date.now()});
  };
  const progress=(line:string)=>{const current=this.get(task.id);if(!current||abort.signal.aborted)return;updateMediaTask(this.db,task.id,{progress:[...current.progress,line]});const settled=this.delivery.settle(task.id).catch(error=>console.error('Media delivery settlement failed',error));const durable=this.journal?settled.then(()=>this.persist()):settled;void durable.catch(failDurable);this.changes.emit(task.id);};
  const job=this.scheduler.run(async()=>{
   if(abort.signal.aborted)throw new Error('Cancelled before provider dispatch');
   if(request.canvasDelivery)await this.delivery.assertPendingTarget(task.id);
   updateMediaTask(this.db,task.id,{status:'running'});progress('正在执行媒体生成');
   await this.persist();
   await this.checkpoint(this.get(task.id)!);
   const references=[...new Set([request.image,...(Array.isArray(request.images)?request.images:[])].filter((value):value is string=>typeof value==='string'&&value.length>0&&!/^(?:https?:|data:)/.test(value)))];
   if(references.length>32)throw new Error('At most 32 input files are allowed');
   const inputs:Array<{path:string;content:Uint8Array;mime:string}>=[];let inputBytes=0;
   for(const name of references){
    const remote=this.imageFiles?await this.imageFiles.read(projectId,name):undefined;
    if(this.imageFiles&&!remote)throw new Error('Reference image is not present in cloud storage');
    const file=remote?{...remote.file,buffer:remote.buffer}:await readProjectFile(this.registry.projectsRoot,projectId,name,this.registry.get(projectId)?.metadata);
    inputBytes+=file.size;if(inputBytes>50*1024*1024)throw new Error('Media input files exceed 50 MB');inputs.push({path:file.name,content:file.buffer,mime:file.mime});
   }
   abort.signal.throwIfAborted();
   const result=await this.adapter!.generate({taskId:task.id,projectId,request,inputs,signal:abort.signal,onProgress:progress});
   if(abort.signal.aborted)return;
   if(!result.content.byteLength||result.content.byteLength>1024*1024*1024)throw new Error('Invalid or oversized media output');
   if(!result.mime.startsWith(`${surface}/`))throw new Error('Media output MIME does not match requested surface');
   if(surface==='image'&&result.mime!=='image/svg+xml')await sharp(result.content).metadata();
   if(typeof request.output==='string'&&result.path!==request.output)throw new Error('Media output differs from declared project path');
   const toolResult=result.toolResult===undefined?undefined:parseToolResultPayload(result.toolResult);
   const writeImage=async(path:string,content:Uint8Array,mime:string)=>
    surface==='image'&&this.imageFiles
     ?await this.imageFiles.write(projectId,path,content,mime)
     :await writeProjectFile(this.registry.projectsRoot,projectId,path,Buffer.from(content),{overwrite:false},this.registry.get(projectId)?.metadata);
   let file:unknown;
   if(!toolResult){
    file=await writeImage(result.path,result.content,result.mime);
   }else{
    // Complete tool result: persist the plan before the first byte so a crash
    // mid-upload leaves an inspectable partial, stage every artifact, and only
    // then mark the task done. No output may be silently dropped.
    if(createHash('sha256').update(result.content).digest('hex')!==createHash('sha256').update(toolResult.artifacts[0]!.content).digest('hex'))throw new Error('Tool result primary artifact does not match the primary output');
    if(toolResult.artifacts[0]!.mime!==result.mime)throw new Error('Tool result primary MIME does not match the primary output');
    const plan=planToolDelivery(task.id,projectId,result.path,toolResult);
    if(plan.artifacts.some(item=>item.storage==='json')&&!this.toolArtifacts)throw Object.assign(new Error('Tool result carries JSON edit artifacts but tool artifact storage is not configured'),{status:503,code:'IMAGE_TOOL_ARTIFACT_UNAVAILABLE'});
    await this.toolJournal?.begin(plan);
    const stored=new Map<number,{path:string;fileId?:string}>();let primaryFile:unknown;
    for(let i=0;i<plan.artifacts.length;i+=1){
     const item=plan.artifacts[i]!,artifact=toolResult.artifacts[i]!;
     abort.signal.throwIfAborted();
     progress(`正在保存工具产物 ${i+1}/${plan.artifacts.length}`);
     if(item.storage==='json'){
      const saved=await this.toolArtifacts!.put({namespace:'media-tools',projectId},{id:item.id,role:item.role,path:item.path,mime:item.mime,content:artifact.content,...(item.width!==undefined?{width:item.width,height:item.height}:{})});
      if(saved.path!==item.path||saved.sha256!==item.sha256||saved.byteLength!==item.byteLength)throw new Error('Tool artifact storage returned an unexpected record');
      stored.set(item.index,{path:saved.path,fileId:saved.id});
     }else{
      const saved=await writeImage(item.path,artifact.content,item.mime);
      stored.set(item.index,{path:item.path});
      if(item.index===0)primaryFile=saved;
     }
     await this.toolJournal?.staged(task.id,item.path);
    }
    await this.toolJournal?.finish(task.id,'stored');
    file={...(primaryFile as Record<string,unknown>|undefined)??{name:plan.primaryPath,size:0,mime:result.mime},tool:plan.tool,outputs:deliveredOutputs(plan,stored),...(plan.layering!==undefined?{layering:plan.layering}:{})};
   }
   if(abort.signal.aborted)return;
   updateMediaTask(this.db,task.id,{status:'done',file,endedAt:Date.now()});
   await this.persist();
  },()=>progress('等待媒体执行名额，尚未提交供应商')).catch(async error=>{if(!abort.signal.aborted){updateMediaTask(this.db,task.id,{status:'failed',error:{message:error instanceof Error?error.message:String(error),code:'MEDIA_GENERATION_FAILED'},endedAt:Date.now()});await this.persist();}}).finally(async()=>{
   this.active.delete(task.id);await this.delivery.settle(task.id);await this.persist();const final=this.get(task.id)!;await this.checkpoint(final);this.changes.emit(task.id);
   recordProjectLedgerObservation({projectId,type:`media.task.${final.status}`,source:'media-adapter',entityType:'media_task',entityId:task.id,correlationId:task.id,summary:final.error?.message??'Media task completed',payload:{surface,model:request.model,file:final.file},idempotencyKey:`media:${task.id}:${final.status}`});
   await this.persist();
  });
  this.jobs.add(job);void job.finally(()=>this.jobs.delete(job)).catch(error=>console.error('Media delivery reconciliation failed',error));
  return {...this.snapshot(task),canvasDeliveryOwned:Boolean(request.canvasDelivery)};
 }
 async cancel(id:string){if(this.journal){await this.ready();this.journal.assertHealthy();}const task=this.get(id);if(!task)return null;if(['queued','running'].includes(task.status)){this.active.get(id)?.abort();updateMediaTask(this.db,id,{status:'interrupted',error:{code:'CANCELLED',message:'Cancellation requested; no output will be published'},endedAt:Date.now()});await this.delivery.settle(id);await this.persist();this.changes.emit(id);}return this.snapshot(this.get(id)!);}
 async retry(id:string){if(this.journal){await this.ready();this.journal.assertHealthy();}const task=this.get(id);if(!task)throw new Error('task not found');if(['queued','running'].includes(task.status))throw new Error('task is still running');const row=this.db.prepare('SELECT request_json AS request FROM media_adapter_requests WHERE task_id=?').get(id) as {request:string}|undefined;if(!row)throw new Error('Original request is unavailable; submit a new request');const request=JSON.parse(row.request) as Record<string,unknown>;return this.submit(task.projectId,{...request,clientRequestId:randomUUID(),...(typeof request.output==='string'?{output:request.output.replace(/(\.[^./]+)$/u,`-${randomUUID()}$1`)}:{})});}
 wait(id:string,signal:AbortSignal):Promise<ReturnType<MediaAdapterService['snapshot']>|null>{const current=this.get(id);if(!current)return Promise.resolve(null);if(!['queued','running'].includes(current.status))return Promise.resolve(this.snapshot(current));return new Promise(resolve=>{const done=()=>{this.changes.off(id,changed);signal.removeEventListener('abort',done);const task=this.get(id);resolve(task?this.snapshot(task):null);};const changed=()=>{const task=this.get(id);if(!task||!['queued','running'].includes(task.status))done();};this.changes.on(id,changed);signal.addEventListener('abort',done,{once:true});if(signal.aborted)done();});}
 async close(){this.scheduler.close();for(const id of this.active.keys()){this.active.get(id)?.abort();await this.cancel(id).catch(()=>{});}await Promise.allSettled(this.jobs);}
}
