import type {MediaAdapter,MediaCatalog} from './media/adapter-service.js';
import type {CapabilityAdapter} from './routes/media.js';
import type {AssetAdapter} from './routes/assets.js';
import type {AgentAdapter,TaskDelivery} from './services-tasks.js';
import {createHash} from 'node:crypto';
import {lstat,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {assertProjectPathHasNoSymlinks} from './project-layout.js';
/** HTTP adapters are explicitly configured integrations, never inferred product services. */
function client(base:string,token?:string){const origin=new URL(base);if(!['http:','https:'].includes(origin.protocol))throw new Error('Adapter URL must be HTTP(S)');return async<T>(endpoint:string,body?:unknown,signal?:AbortSignal):Promise<T>=>{const response=await fetch(new URL(endpoint,origin),{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal??AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`Adapter returned HTTP ${response.status}`);return await response.json() as T;};}
export function createHttpAgentAdapter(base:string,token?:string):AgentAdapter {
 const request=client(base,token);
 return {async execute(input){
  const inputFiles:Array<{path:string;digest:string;contentBase64:string}>=[];let total=0;
  if(input.workspace){
   const root=await realpath(input.workspace.cwd);
   for(const item of input.workspace.inputs){
    if(!item.path||path.isAbsolute(item.path)||item.path.includes('\\')||item.path.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('Invalid staged input path');
    assertProjectPathHasNoSymlinks(root,item.path);const target=path.join(root,item.path);const stat=await lstat(target);
    if(!stat.isFile()||stat.isSymbolicLink()||!(await realpath(target)).startsWith(`${root}${path.sep}`))throw new Error('Staged input escapes isolated workspace');
    total+=stat.size;if(total>20*1024*1024)throw new Error('Staged inputs exceed 20 MB');
    const content=await readFile(target);const digest=createHash('sha256').update(content).digest('hex');if(digest!==item.digest)throw new Error('Staged input digest changed');
    inputFiles.push({path:item.path,digest,contentBase64:content.toString('base64')});
   }
  }
  return request<TaskDelivery>('',{task:input.task,request:input.request,...(input.workspace?{workspace:input.workspace}:{}),inputFiles,...(input.execution?{execution:input.execution}:{}),...(input.systemPrompt?{systemPrompt:input.systemPrompt}:{}),...(input.skillIds?{skillIds:input.skillIds}:{})},input.signal);
 }};
}
export function createHttpMediaAdapter(base:string,token?:string):MediaAdapter{
 const request=client(base,token);return {
  catalog:()=>request<MediaCatalog>('/models'),config:()=>request('/config'),configure:value=>request('/config',value),
  async generate(input){const result=await request<{path:string;contentBase64:string;mime:string;progress?:string[]}>('/generate',{taskId:input.taskId,projectId:input.projectId,request:input.request,inputs:input.inputs.map(file=>({path:file.path,mime:file.mime,contentBase64:Buffer.from(file.content).toString('base64')}))},input.signal);for(const line of result.progress??[])input.onProgress(line);if(typeof result.contentBase64!=='string')throw new Error('Media adapter must return contentBase64');return {path:result.path,content:Buffer.from(result.contentBase64,'base64'),mime:result.mime};},
 };
}
export function createHttpCapabilityAdapter(base:string,token?:string):CapabilityAdapter{const request=client(base,token);return {agents:()=>request('/agents'),models:agentId=>request(`/models${agentId?`?agentId=${encodeURIComponent(agentId)}`:''}`),knowledge:query=>request('/knowledge/query',query),resources:(kind,id)=>request(`/resources/${encodeURIComponent(kind)}${id?`/${encodeURIComponent(id)}`:''}`)};}
export function createHttpAssetAdapter(base:string,token?:string):AssetAdapter{const request=client(base,token);return {list:(projectId,query)=>request('/assets/query',{projectId,query}),async import(projectId,reference){const result=await request<{files:Array<{path:string;contentBase64:string}>}>('/assets/import',{projectId,reference});if(!Array.isArray(result.files))throw new Error('Asset adapter must return file bytes');return {files:result.files.map(file=>({path:file.path,content:Buffer.from(file.contentBase64,'base64')}))};}};}
