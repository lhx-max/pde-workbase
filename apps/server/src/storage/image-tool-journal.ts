import {createHash} from 'node:crypto';
import type {JsonStatePort} from '@ks-designai/app-cloud-state';
import type {ToolExecutionJournal,ToolExecutionRecord,ToolStorageScope} from '@ks-designai/image-card-pack/artifact-contract';

/** A namespace's single trusted writer owns this journal. This is not distributed CAS. */
const serials=new WeakMap<JsonStatePort,Map<string,Promise<unknown>>>();
const failure=(code:string,message:string,status:number)=>Object.assign(new Error(message),{code,status});
const scopeKey=(scope:ToolStorageScope,id:string)=>`image-tool-job-${createHash('sha256').update(JSON.stringify([scope.namespace,scope.projectId,id])).digest('hex')}`;
export class ImageToolCloudJournal implements ToolExecutionJournal {
 constructor(private readonly state:JsonStatePort,private readonly authorize:(scope:ToolStorageScope,mode:'read'|'write')=>Promise<void>,options:{singleWriter:true}){
  if(!state||!authorize||options?.singleWriter!==true)throw failure('IMAGE_TOOL_JOURNAL_UNAVAILABLE','工具任务需要显式单写者云存储',503);
 }
 async load(scope:ToolStorageScope,id:string):Promise<ToolExecutionRecord|null>{
  await this.authorize(scope,'read');await this.state.ready;await this.state.flush();
  const value=this.state.read(scopeKey(scope,id));if(value===undefined)return null;
  return this.checked(scope,id,value);
 }
 private checked(scope:ToolStorageScope,id:string,value:unknown):ToolExecutionRecord{
  const record=value as Partial<ToolExecutionRecord>|null;
  if(!record||record.schemaVersion!=='image-tool-execution/v1'||record.id!==id||record.scope?.namespace!==scope.namespace||record.scope?.projectId!==scope.projectId||!Number.isSafeInteger(record.revision)||record.revision! < 0)throw failure('IMAGE_TOOL_JOURNAL_INVALID','工具任务归属或版本无效',503);
  return structuredClone(record as ToolExecutionRecord);
 }
 async save(scope:ToolStorageScope,id:string,expectedRevision:number|null,value:ToolExecutionRecord):Promise<void>{
  const snapshot=this.checked(scope,id,value);
  await this.authorize(scope,'write');await this.state.ready;
  if(expectedRevision!==null&&(!Number.isSafeInteger(expectedRevision)||expectedRevision<0))throw failure('IMAGE_TOOL_JOURNAL_INVALID','工具任务预期版本无效',400);
  if(snapshot.revision!==(expectedRevision===null?0:expectedRevision+1))throw failure('IMAGE_TOOL_JOURNAL_INVALID','工具任务版本必须递增',400);
  const key=scopeKey(scope,id);let locks=serials.get(this.state);if(!locks){locks=new Map();serials.set(this.state,locks);}
  const previous=locks.get(key)??Promise.resolve();
  const next=previous.catch(()=>{}).then(async()=>{
   const stored=this.state.read(key),current=stored===undefined?null:this.checked(scope,id,stored);
   if((current?.revision??null)!==expectedRevision)throw failure('IMAGE_TOOL_REVISION_CONFLICT','工具任务已被修改',409);
   this.state.write(key,snapshot);await this.state.flush();
  });locks.set(key,next);
  try{await next;}finally{if(locks.get(key)===next)locks.delete(key);}
 }
}
