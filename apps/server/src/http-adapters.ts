import {parseToolResultPayload} from './media/tool-delivery.js';
import type {MediaAdapter,MediaCatalog} from './media/adapter-service.js';
import type {CapabilityAdapter} from './routes/media.js';
import type {AssetAdapter} from './routes/assets.js';
import {createHash} from 'node:crypto';
import {lstat,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {assertProjectPathHasNoSymlinks} from './project-layout.js';
/** HTTP adapters are explicitly configured integrations, never inferred product services. */
function client(base:string,token?:string){const origin=new URL(base);if(!['http:','https:'].includes(origin.protocol))throw new Error('Adapter URL must be HTTP(S)');return async<T>(endpoint:string,body?:unknown,signal?:AbortSignal):Promise<T>=>{const response=await fetch(new URL(endpoint,origin),{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal??AbortSignal.timeout(30000)});if(!response.ok){
 const failure=await response.json().catch(()=>null) as {error?:{code?:unknown;message?:unknown}}|null;
 const error=failure?.error;
 if(typeof error?.code==='string'&&/^IMAGE_[A-Z_]+$/.test(error.code)&&typeof error.message==='string'&&error.message.length<=300)
  throw Object.assign(new Error(error.message),{code:error.code,status:response.status});
 throw new Error(`Adapter returned HTTP ${response.status}`);
 }return await response.json() as T;};}
export function createHttpMediaAdapter(base:string,token?:string):MediaAdapter{
 const request=client(base,token);return {
  identityMode:'service-only',
  catalog:()=>request<MediaCatalog>('/models'),config:()=>request('/config'),configure:value=>request('/config',value),
  /** Capability metadata from the adapter's /tools endpoint; absent means the
   * service does not expose image tools. */
  tools:async()=>{try{return await request('/tools');}catch(error){if(error instanceof Error&&/HTTP 404$/u.test(error.message))return{tools:[]};throw error;}},
  async generate(input){const result=await request<{path:string;contentBase64:string;mime:string;progress?:string[];toolResult?:{kind?:unknown;artifacts?:unknown;layering?:unknown}}>('/generate',{taskId:input.taskId,projectId:input.projectId,request:input.request,inputs:input.inputs.map(file=>({path:file.path,mime:file.mime,contentBase64:Buffer.from(file.content).toString('base64')}))},input.signal);for(const line of result.progress??[])input.onProgress(line);if(typeof result.contentBase64!=='string')throw new Error('Media adapter must return contentBase64');
   // Decode the complete tool result before it crosses into the service; all
   // bounds/MIME/role checks run in parseToolResultPayload downstream.
   let toolResult;if(result.toolResult!==undefined){
    const artifacts=Array.isArray(result.toolResult.artifacts)?result.toolResult.artifacts.map(entry=>{
     const artifact=entry&&typeof entry==='object'&&!Array.isArray(entry)?entry as Record<string,unknown>:{};
     const {contentBase64,...metadata}=artifact;
     if(typeof contentBase64!=='string'||contentBase64.length>40_000_004||!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(contentBase64))throw new Error('Tool adapter returned invalid or oversized base64');
     return {...metadata,content:Buffer.from(contentBase64,'base64')};
    }):result.toolResult.artifacts;
    toolResult=parseToolResultPayload({kind:result.toolResult.kind,artifacts,...(result.toolResult.layering!==undefined?{layering:result.toolResult.layering}:{})});
   }
   return {path:result.path,content:Buffer.from(result.contentBase64,'base64'),mime:result.mime,...(toolResult!==undefined?{toolResult}:{})};},
 };
}
export function createHttpCapabilityAdapter(base:string,token?:string):CapabilityAdapter{const request=client(base,token);return {agents:()=>request('/agents'),models:agentId=>request(`/models${agentId?`?agentId=${encodeURIComponent(agentId)}`:''}`),knowledge:query=>request('/knowledge/query',query),resources:(kind,id)=>request(`/resources/${encodeURIComponent(kind)}${id?`/${encodeURIComponent(id)}`:''}`)};}
export function createHttpAssetAdapter(base:string,token?:string):AssetAdapter{const request=client(base,token);return {list:(projectId,query)=>request('/assets/query',{projectId,query}),async import(projectId,reference){const result=await request<{files:Array<{path:string;contentBase64:string}>}>('/assets/import',{projectId,reference});if(!Array.isArray(result.files))throw new Error('Asset adapter must return file bytes');return {files:result.files.map(file=>({path:file.path,content:Buffer.from(file.contentBase64,'base64')}))};}};}
