/** Narrow operator transport. No redirects, bounded timeout, sanitized errors. */
import {writerLockDocumentId} from '../../../packages/app-cloud-state/src/index.js';
export function createProvisionClient(options:{endpoint:string;projectId:string;databaseId:string;bucketId:string;app:string;apiKey?:string;consoleCookie?:string;fetcher?:typeof fetch}){
 let url:URL;try{url=new URL(options.endpoint);}catch{throw Error('Valid HTTPS endpoint required');}if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('/v1'))throw Error('Provisioning requires a credential-free HTTPS /v1 endpoint');
 if(!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,35}$/.test(options.projectId))throw Error('Explicit project ID required');
 if(Boolean(options.apiKey)===Boolean(options.consoleCookie))throw Error('Exactly one explicit provisioning credential is required');
 const headers:Record<string,string>={'x-appwrite-project':options.projectId,'content-type':'application/json'};
 if(options.apiKey){if(!options.apiKey.trim()||options.apiKey.length>16384||/[\r\n\x00]/.test(options.apiKey))throw Error('Invalid provisioning key');headers['x-appwrite-key']=options.apiKey;}
 if(options.consoleCookie){if(url.origin!=='https://frontend-cloud.corp.kuaishou.com'||options.projectId!=='grworkspace')throw Error('Maintenance sessions are restricted to the explicit company project');if(process.env.NODE_ENV==='production')throw Error('Console maintenance is forbidden in production');const match=/(?:^|;\s*)a_session_console=([^;\s]+)/.exec(options.consoleCookie);if(!match||/[\r\n\x00]/.test(options.consoleCookie))throw Error('Explicit console maintenance session required');headers.cookie='a_session_console='+match[1];headers['x-appwrite-mode']='admin';}
 const base=options.endpoint.replace(/\/$/,''),fetcher=options.fetcher??fetch,lockPath=`/databases/${options.databaseId}/collections/app_runtime_state/documents/${writerLockDocumentId(options.app)}`;
 async function request<T>(method:string,path:string,body?:unknown,missing=false):Promise<T|null>{
  const ownDb='/databases/'+options.databaseId,ownBucket='/storage/buckets/'+options.bucketId;
  const permitted=path===ownDb||path.startsWith(ownDb+'/collections/')||path===ownDb+'/collections'||path===ownBucket||method==='POST'&&path==='/databases'&&(body as {databaseId?:unknown})?.databaseId===options.databaseId||method==='POST'&&path==='/storage/buckets'&&(body as {bucketId?:unknown})?.bucketId===options.bucketId;
  if(/%(?:2e|2f|5c)/i.test(path.split('?')[0]!)||path.includes('\\')||path.includes('#'))throw Error('Noncanonical provisioning route');
  if(!permitted)throw Error('Provisioning transport target is outside the selected app resources');
  if(!['GET','POST','DELETE'].includes(method)||method==='DELETE'&&path!==lockPath||!path.startsWith('/')||path.startsWith('//')||/(?:^|\/)\.\.?(?:\/|$)/.test(path.split('?')[0]!)||/[\r\n]/.test(path))throw Error('Provisioning transport mutation is outside its bounded contract');
  let response:Response;try{response=await fetcher(base+path,{method,headers,redirect:'error',signal:AbortSignal.timeout(20_000),...(body===undefined?{}:{body:JSON.stringify(body)})});}catch{throw Error('Provisioning transport unavailable; inspect state before resuming');}
  if(missing&&response.status===404)return null;
  if(!response.ok)throw Object.assign(new Error('Provisioning request failed (HTTP '+response.status+'); no automatic retry'),{status:response.status});
  if(response.status===204)return undefined as T;
  try{return await response.json() as T;}catch{throw Error('Provisioning response was not valid JSON');}
 }
 return{call:<T>(method:string,path:string,body?:unknown)=>request<T>(method,path,body) as Promise<T>,getOrNull:<T>(path:string)=>request<T>('GET',path,undefined,true),docsPath:(databaseId:string,collectionId:string)=>`/databases/${encodeURIComponent(databaseId)}/collections/${encodeURIComponent(collectionId)}/documents`};
}
