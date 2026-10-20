import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CanvasTaskExecutionContext, CanvasTaskRequest, CanvasTaskReceipt, CanvasTaskDelivery, CanvasTaskWithRequest, ExecutionSnapshot } from '@bezier/contracts';
import { CanvasStateService } from './canvas/state.js';
import { prepareCanvasGenerationWorkspace } from './canvas/generation-workspace.js';
import { materializeCanvasArtifactResponse, prepareCanvasTextWorkspace, type CanvasArtifactWorkspace, type CanvasWorkingCopy } from './canvas/artifact-workspace.js';
import { saveCanvasTextCandidate } from './canvas/text-candidate.js';
import { assertProjectPathHasNoSymlinks } from './project-layout.js';
import { ProjectSerialLock } from './storage/project-serial-lock.js';
import type { ProjectRegistry } from './storage/project-registry.js';
import { recordProjectLedgerObservation } from './project-ledger/active-recorder.js';

import { normalizeTaskRequest, taskRequestDigest } from './task-request.js';
import { resolveTaskSkills, type InstalledTaskSkill } from './task-skills.js';

export type TaskRequest = CanvasTaskRequest;
export type TaskDelivery = CanvasTaskDelivery;
export type TaskReceipt = CanvasTaskReceipt;
interface StoredTask { receipt: TaskReceipt; request: TaskRequest; requestDigest?: string; workspace?: CanvasWorkingCopy; artifact?: CanvasArtifactWorkspace; baseDigest?: string; delivery?: TaskDelivery; }
/** Executor receives only an isolated working copy; publication remains server-owned. */
export interface AgentExecutionContext {execution?:ExecutionSnapshot;systemPrompt?:string;skillIds?:string[];executionContext?:CanvasTaskExecutionContext;installedSkills?:InstalledTaskSkill[]}
export interface AgentAdapter {
 execute(input: {task: TaskReceipt; request: TaskRequest; workspace?: CanvasWorkingCopy; signal: AbortSignal}&AgentExecutionContext): Promise<TaskDelivery>;
}
export class AgentTasks {
 private readonly active = new Map<string, AbortController>();
 private readonly lock = new ProjectSerialLock();
 constructor(private readonly registry: ProjectRegistry, private readonly canvas: CanvasStateService, private readonly adapter?: AgentAdapter, private readonly installedSkillRoot?: string) {}
 private directory() { return path.join(this.registry.dataRoot, 'agent-tasks'); }
 private file(id: string) { if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('invalid task id'); return path.join(this.directory(), `${id}.json`); }
 private save(task: StoredTask) {
  task.receipt.updatedAt = Date.now(); mkdirSync(this.directory(), {recursive:true});
  const file = this.file(task.receipt.id), temporary = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temporary, JSON.stringify(task), {mode:0o600, flush:true}); renameSync(temporary,file);
 }
 private load(id: string): StoredTask | null {
  const file=this.file(id); if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file,'utf8')) as StoredTask;
 }
 findByRequestId(projectId:string,requestId:string):TaskReceipt|null {
  if(!existsSync(this.directory()))return null;
  for(const file of readdirSync(this.directory())){if(!file.endsWith('.json'))continue;const stored=this.load(file.slice(0,-5));if(stored?.receipt.projectId===projectId&&stored.receipt.requestId===requestId)return this.get(projectId,stored.receipt.id);}
  return null;
 }
 getById(id:string):TaskReceipt|null {const stored=this.load(id);return stored?this.get(stored.receipt.projectId,id):null;}
 get(projectId:string,id:string): TaskReceipt | null {
  const task=this.load(id); if (!task || task.receipt.projectId!==projectId) return null;
  if (['queued','running'].includes(task.receipt.status) && !this.active.has(id)) {
   task.receipt.status='interrupted'; task.receipt.error='Server restarted before execution completed; candidate and receipt retained'; this.save(task);
  }
  return task.receipt;
 }
 async submit(projectId:string, request:TaskRequest,runtimeContext:AgentExecutionContext={}):Promise<TaskReceipt> {
   request = normalizeTaskRequest(request);
   const requestDigest = taskRequestDigest(request);
  if (request.canvasTextGeneration && request.canvasArtifactGeneration) throw new Error('one generation target is required');
  return this.lock.run(projectId, async()=>{
   const directory=this.directory();
   if (existsSync(directory)) for (const entry of readdirSync(directory)) {
    if (!entry.endsWith('.json')) continue;
    const saved=this.load(entry.slice(0,-5));
    if(saved?.receipt.projectId===projectId && saved.receipt.requestId===request.requestId) {
     if((saved.requestDigest ?? taskRequestDigest(saved.request))!==requestDigest) throw Object.assign(new Error('requestId already belongs to a different request'), {status:409,code:'TASK_REQUEST_CONFLICT'});
     return this.get(projectId,saved.receipt.id)!;
    }
   }
   if(!this.adapter) throw Object.assign(new Error('No agent adapter configured'),{status:503,code:'AGENT_ADAPTER_UNAVAILABLE'});
   const installedSkills = resolveTaskSkills(this.installedSkillRoot, [...(request.executionContext?.skillIds ?? []), ...(request.executionContext?.context?.skillIds ?? [])]);
   const adapterContext: AgentExecutionContext = { ...runtimeContext,
    ...(request.executionContext ? { executionContext: request.executionContext } : {}),
    ...(installedSkills.length ? { installedSkills,
      skillIds: [...new Set([...(runtimeContext.skillIds ?? []), ...installedSkills.map(skill => skill.id)])],
      systemPrompt: [runtimeContext.systemPrompt, ...installedSkills.map(skill => `Installed task skill: ${skill.id}\n${skill.instructions}\n${skill.resources.map(resource => `Resource: ${resource.path}\n${resource.content}`).join('\n\n')}`)].filter(Boolean).join('\n\n'),
    } : {}),
   };
   const root=this.registry.resolveProjectRoot(projectId); if(!root) throw new Error('project not found');
   const id=randomUUID(), now=Date.now();
   const task:StoredTask={receipt:{id,projectId,requestId:request.requestId,status:'queued',createdAt:now,updatedAt:now},request,requestDigest};
   const binding=request.canvasArtifactGeneration ?? request.canvasTextGeneration;
   if(binding) {
    if(binding.requestId!==request.requestId) throw new Error('generation requestId does not match task requestId');
    const snapshot=await this.canvas.read(projectId);
    const nodes=Array.isArray(snapshot.state.workbenchBasicNodes)?snapshot.state.workbenchBasicNodes as Record<string,unknown>[]:[];
    const node=nodes.find(node=>node.id===binding.nodeId); if(!node) throw new Error('generation target does not exist');
    const generation=node.generation as Record<string,unknown>|undefined;
    if(generation?.requestId!==binding.requestId) throw new Error('generation binding is stale; persist the target request before submitting');
    const prepared=prepareCanvasGenerationWorkspace({runtimeDataDir:this.registry.dataRoot,runId:id,projectId,projectRoot:root,artifact:request.canvasArtifactGeneration,text:request.canvasTextGeneration,nodes,references:request.inputPaths??[],requestedReferenceCount:request.inputPaths?.length??0});
    task.workspace=prepared.workspace; if(prepared.artifact) task.artifact=prepared.artifact;
    task.baseDigest=`sha256:${createHash('sha256').update(typeof node.text==='string'?node.text:'').digest('hex')}`;
   } else task.workspace=prepareCanvasTextWorkspace({runtimeDataDir:this.registry.dataRoot,projectRoot:root,runId:id,references:request.inputPaths??[]});
   this.save(task);
   const abort=new AbortController(); this.active.set(id,abort);
   void (async()=>{
    try {
     task.receipt.status='running'; this.save(task);
     const delivery=await this.adapter!.execute({...adapterContext,task:task.receipt,request,...(task.workspace?{workspace:task.workspace}:{}),signal:abort.signal});
     if(!abort.signal.aborted) await this.deliver(projectId,id,delivery);
    } catch(error) {
     const current=this.load(id)!;
     if(current.receipt.status!=='cancelled' && current.receipt.status!=='succeeded') {current.receipt.status='failed';current.receipt.error=String(error);this.save(current);}
    } finally {this.active.delete(id);}
   })();
   return task.receipt;
  });
 }
 async cancel(projectId:string,id:string):Promise<TaskReceipt|null> {
  return this.lock.run(id,async()=>{const task=this.load(id);if(!task||task.receipt.projectId!==projectId)return null;
   if(['queued','running','interrupted'].includes(task.receipt.status)){this.active.get(id)?.abort();task.receipt.status='cancelled';this.save(task);}return task.receipt;});
 }
 async deliver(projectId:string,id:string,delivery:TaskDelivery):Promise<TaskReceipt> {
  return this.lock.run(id,async()=>{
   const task=this.load(id); if(!task||task.receipt.projectId!==projectId) throw new Error('task not found');
   if(task.receipt.status==='cancelled') throw new Error('task was cancelled; delivery rejected');
   if(task.receipt.status==='succeeded') {
    if(JSON.stringify(task.delivery)!==JSON.stringify(delivery)) throw new Error('completed task has a different delivery');
    return task.receipt;
   }
   if(typeof delivery.content!=='string' || Buffer.byteLength(delivery.content)>20*1024*1024) throw new Error('invalid delivery content');
   task.delivery=delivery;this.save(task);
   const root=this.registry.resolveProjectRoot(projectId);if(!root)throw new Error('project not found');
   const files:string[]=[];
   try {
    let total=Buffer.byteLength(delivery.content);const names=new Set<string>();
    if(delivery.files!==undefined&&(!Array.isArray(delivery.files)||delivery.files.length>100))throw new Error('invalid delivery file list');
    const prepared=(delivery.files??[]).map(file=>{
     if(typeof file.path!=='string'||!file.path||path.isAbsolute(file.path)||file.path.includes('\\')||file.path.split('/').some(part=>!part||part==='.'||part==='..'||part.startsWith('.')))throw new Error('invalid artifact path');
     if(names.has(file.path))throw new Error('duplicate artifact path');for(const other of names)if(file.path.startsWith(`${other}/`)||other.startsWith(`${file.path}/`))throw new Error('artifact file and directory paths conflict');names.add(file.path);
     if(typeof file.content!=='string'||(file.encoding!==undefined&&!['utf8','base64'].includes(file.encoding)))throw new Error('invalid delivery file content');
     const bytes=Buffer.from(file.content,file.encoding==='base64'?'base64':'utf8');total+=bytes.length;if(total>50*1024*1024)throw new Error('delivery exceeds 50 MB');
     const base=task.artifact&&file.path===task.artifact.outputPath?task.artifact.cwd:root;
     assertProjectPathHasNoSymlinks(base,file.path);const target=path.join(base,file.path);
     return {name:file.path,base,target,bytes};
    });
    for(const file of prepared){try{if(!(await readFile(file.target)).equals(file.bytes))throw new Error('artifact target already contains different bytes');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
    for(const file of prepared){const {target,bytes}=file;await mkdir(path.dirname(target),{recursive:true});
     try {await writeFile(target,bytes,{flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST'||!(await readFile(target)).equals(bytes))throw error;}
     if(file.base===root)files.push(file.name);
    }
    const text=task.request.canvasTextGeneration;
    if(task.artifact) {
     materializeCanvasArtifactResponse(task.artifact,delivery.content);
     await this.canvas.applyArtifactCandidate(projectId,task.artifact);
     task.receipt.result={content:delivery.content,file:task.artifact.outputPath,canvasNodeId:task.artifact.target!.nodeId,files:[...new Set([...files,task.artifact.outputPath])]};
     task.receipt.deliveryState='applied';
    } else if(text) {
     const candidatePath=saveCanvasTextCandidate(root,id,delivery.content);
     task.receipt.result={content:delivery.content,canvasNodeId:text.nodeId,candidatePath,files};
     task.receipt.deliveryState='candidate_saved';
     if(text.outputKind==='storyboard') {
      await this.canvas.applyStoryboardCandidate(projectId,{nodeId:text.nodeId,requestId:text.requestId,runId:id,content:delivery.content});
      task.receipt.deliveryState='applied';
     } else if(text.outputKind==='text') await this.canvas.linkTextCandidate(projectId,{nodeId:text.nodeId,requestId:text.requestId,runId:id,content:delivery.content});
     else {await this.canvas.applyTextCandidate(projectId,{nodeId:text.nodeId,requestId:text.requestId,baseDigest:task.baseDigest!,content:delivery.content});task.receipt.deliveryState='applied';}
    } else task.receipt.result={content:delivery.content,files};
    task.receipt.status='succeeded';delete task.receipt.error;
   } catch(error) {
    if(task.artifact){try{assertProjectPathHasNoSymlinks(root,task.artifact.outputPath);const published=await readFile(path.join(root,task.artifact.outputPath));const candidate=await readFile(path.join(task.artifact.cwd,task.artifact.outputPath));if(published.equals(candidate)){files.push(task.artifact.outputPath);task.receipt.result={...task.receipt.result,candidatePath:task.artifact.outputPath};task.receipt.deliveryState='candidate_saved';}}catch{/* Failed publication has no project candidate pointer. */}}
     task.receipt.result={...task.receipt.result,content:delivery.content,files:[...new Set([...(task.receipt.result?.files??[]),...files])]};
     task.receipt.status='failed';task.receipt.deliveryState=task.receipt.deliveryState==='candidate_saved'?'candidate_saved':'delivery_failed';task.receipt.error=error instanceof Error?error.message:String(error);
   }
   this.save(task);
   recordProjectLedgerObservation({projectId,type:`agent.task.${task.receipt.status}`,source:'agent-adapter',entityType:'canvas_node',entityId:task.receipt.result?.canvasNodeId??id,correlationId:id,summary:task.receipt.error??'Agent task delivered',payload:{taskId:id,deliveryState:task.receipt.deliveryState},evidenceRefs:files.map(file=>({kind:'project_file',id:file,path:file})),idempotencyKey:`task:${id}:${task.receipt.status}`});
   return task.receipt;
  });
 }
 list(projectId:string):CanvasTaskWithRequest[]{
  if(!existsSync(this.directory()))return [];
  return readdirSync(this.directory()).filter(file=>file.endsWith('.json')).flatMap(file=>{const task=this.load(file.slice(0,-5));return task?.receipt.projectId===projectId?[{...this.get(projectId,task.receipt.id)!,request:task.request}]:[];}).sort((a,b)=>b.createdAt-a.createdAt);
 }
 async adoptText(projectId:string,id:string):Promise<TaskReceipt>{
  return this.lock.run(id,async()=>{
   const task=this.load(id);if(!task||task.receipt.projectId!==projectId)throw new Error('task not found');
   const text=task.request.canvasTextGeneration;if(!text||text.outputKind==='storyboard'||!task.delivery||!task.baseDigest)throw new Error('No verifiable text candidate');
   if(task.receipt.status==='cancelled')throw new Error('task was cancelled');
   if(task.receipt.deliveryState==='applied')return task.receipt;
   await this.canvas.applyTextCandidate(projectId,{nodeId:text.nodeId,requestId:text.requestId,baseDigest:task.baseDigest,content:task.delivery.content});
   task.receipt.deliveryState='applied';task.receipt.status='succeeded';delete task.receipt.error;this.save(task);return task.receipt;
  });
 }
 async recoverDeliveries():Promise<void>{
  if(!existsSync(this.directory()))return;
  for(const file of readdirSync(this.directory())){
   if(!file.endsWith('.json'))continue;const task=this.load(file.slice(0,-5));
   if(task?.delivery&&['queued','running','interrupted'].includes(task.receipt.status))await this.deliver(task.receipt.projectId,task.receipt.id,task.delivery);
  }
 }
}
