/** Public HTTP lifecycle acceptance. Test callers and dependencies are explicit;
 * this helper never imports application implementation or accesses storage. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
type App='doc'|'sketch';
interface Reply{status:number;data:any;bytes:Uint8Array}
interface Options{method?:string;body?:unknown;key?:string;sso?:string;instance?:string}
export async function probeAppLifecycles(options:{request:(app:App,route:string,options?:Options)=>Promise<Reply>;teamId:string;png:Uint8Array}){
 const checks:string[]=[],failures:string[]=[],evidence:any={};
 const states=new Map<App,{sourceId:string;copyId:string;sourceContent:string;copyContent:string;restoreBody:any;restoreKey:string;restoreReceipt:string;readProvider:()=>Promise<Reply>}>();
 const req=options.request;
 const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
 const check=async(name:string,fn:()=>Promise<void>)=>{try{await fn();checks.push(name);return true;}catch(e){failures.push(name+': '+(e instanceof Error?e.message:String(e)));return false;}};
 const coi=async(app:App,id:string,action:string,input:unknown,key:string)=>req(app,`/api/apps/${app}/instances/${id}/actions/${action}`,{body:{input},key});
 const listed=async(app:App)=>{const r=await req(app,`/api/apps/${app}/actions/${app}.list`,{body:{input:{}}});assert.equal(r.status,200,JSON.stringify(r.data));return r.data.data.result.items as Array<{id:string}>;};
 const state=async(app:App,id:string)=>{const r=await req(app,`/api/apps/${app}/instances/${id}/state`);assert.equal(r.status,200,JSON.stringify(r.data));return r.data.data;};
 for(const app of ['doc','sketch']as const){
  const report:any={};evidence[app]=report;
  const provider=async(action:string,input:unknown,key:string,revision?:number)=>{
   const body={protocolVersion:'1.0',requestId:key,idempotencyKey:key,applicationId:app,applicationVersion:'0.1.0',applicationInstanceId:'mai-'+app,providerInstanceId:'mp-'+app,bizId:'fixture-biz',sessionId:'lifecycle-probe',actor:{tenantId:options.teamId,userId:'fixture-writer'},actionId:action,input,...(revision===undefined?{}:{expectedRevision:revision})};
   return req(app,`/open-platform/v1/instances/mp-${app}/actions/${action}`,{body,key});
  };
  let sourceId='',copyId='',sourceRevision=0;const sourceContent=app==='doc'?'Lifecycle source body':JSON.stringify({type:'excalidraw',version:2,source:'lifecycle-probe',elements:[],appState:{},files:{}});
  if(!await check(app+': Provider create binds one canonical cloud resource',async()=>{
   const r=await provider(app+'.create',{name:'Lifecycle '+app,content:sourceContent},'life-'+app+'-create');assert.equal(r.status,200,JSON.stringify(r.data));sourceId=r.data.data.instanceId;assert(sourceId);sourceRevision=r.data.revision;report.sourceId=sourceId;
   const read=await provider(app+'.read',{},'life-'+app+'-read-initial');assert.equal(read.status,200,JSON.stringify(read.data));assert.equal(read.data.data.meta.id,sourceId);assert.equal(read.data.data.content,sourceContent);
  }))continue;
  await check(app+': Provider rename updates metadata and rejects stale version without content loss',async()=>{
   const old=sourceRevision;const r=await provider(app+'.rename',{name:'Lifecycle renamed '+app},'life-'+app+'-rename',old);assert.equal(r.status,200,JSON.stringify(r.data));sourceRevision=r.data.revision;assert(sourceRevision>old);const canonical=await state(app,sourceId);assert.equal(canonical.meta.name,'Lifecycle renamed '+app);assert.equal(canonical.content,sourceContent);
   const stale=await provider(app+'.rename',{name:'stale must not win'},'life-'+app+'-stale-rename',old);assert.equal(stale.status,409,JSON.stringify(stale.data));assert.equal((await state(app,sourceId)).meta.name,'Lifecycle renamed '+app);
  });
  if(!await check(app+': Provider copy is independent and exact-key replay creates no duplicate',async()=>{
   const r=await provider(app+'.copy',{name:'Lifecycle copy '+app},'life-'+app+'-copy',sourceRevision);assert.equal(r.status,200,JSON.stringify(r.data));copyId=r.data.data.instanceId;assert(copyId&&copyId!==sourceId);report.copyId=copyId;assert.equal((await state(app,copyId)).content,sourceContent);
   const replay=await provider(app+'.copy',{name:'Lifecycle copy '+app},'life-'+app+'-copy',sourceRevision);assert.equal(replay.status,200,JSON.stringify(replay.data));assert.equal(replay.data.data.instanceId,copyId);
   const read=await provider(app+'.read',{},'life-'+app+'-read-after-copy');assert.equal(read.status,200);assert.equal(read.data.data.meta.id,sourceId);sourceRevision=read.data.revision;
  }))continue;
  let copyContent='';
  await check(app+': editing the copy leaves source content and binding unchanged',async()=>{
   const before=await state(app,copyId);assert((await listed(app)).some(m=>m.id===copyId));copyContent=app==='doc'?sourceContent+'\nIndependent copy':JSON.stringify({type:'excalidraw',version:2,source:'lifecycle-probe',elements:[{id:'lifecycle-copy',type:'rectangle',x:20,y:20,width:80,height:60,angle:0,strokeColor:'#1b1b1f',backgroundColor:'transparent',fillStyle:'solid',strokeWidth:1,strokeStyle:'solid',roughness:1,opacity:100,groupIds:[],frameId:null,roundness:null,seed:123,version:1,versionNonce:123,updated:1,isDeleted:false,boundElements:null,link:null,locked:false}],appState:{},files:{}});
   const written=await coi(app,copyId,app+'.write',{content:copyContent,expectedRevision:before.revision},'life-'+app+'-copy-write');assert.equal(written.status,200,JSON.stringify(written.data));assert.equal((await state(app,copyId)).content,copyContent);assert.equal((await state(app,sourceId)).content,sourceContent);
  });
  if(app==='sketch')await check('sketch: explicit card binding records only the assigned copy',async()=>{const r=await coi(app,copyId,'sketch.bind',{nodeId:'life-copy-card'},'life-sketch-copy-bind');assert.equal(r.status,200,JSON.stringify(r.data));assert.equal((await state(app,copyId)).meta.nodeId,'life-copy-card');assert.equal((await state(app,sourceId)).meta.nodeId,'ma:mp-sketch');});
  let restoreBody:any,restoreReceipt='';const restoreKey='life-'+app+'-copy-restore';
  await check(app+': copy archive blocks writes; explicit restore keeps content and does not rebind a canvas',async()=>{
   const archived=await coi(app,copyId,app+'.archive',{},'life-'+app+'-copy-archive');assert.equal(archived.status,200,JSON.stringify(archived.data));const before=await state(app,copyId);assert(before.meta.archivedAt);assert(!(await listed(app)).some(m=>m.id===copyId));
   const denied=await coi(app,copyId,app+'.write',{content:sourceContent,expectedRevision:before.revision},'life-'+app+'-archived-write');assert.equal(denied.status,409,JSON.stringify(denied.data));assert.equal((await state(app,copyId)).content,copyContent);
   restoreBody={};const restored=await coi(app,copyId,app+'.restore',restoreBody,restoreKey);assert.equal(restored.status,200,JSON.stringify(restored.data));restoreReceipt=restored.data.data.receiptId;
   const active=await state(app,copyId);assert(!active.meta.archivedAt);assert.equal(active.content,copyContent);assert(!active.meta.nodeId);assert(!active.meta.mirrorCanvasId);assert(!active.meta.mirrorPath);assert((await listed(app)).some(m=>m.id===copyId));
  });
  if(app==='sketch')await check('sketch: supplied PNG export is private and downloads as exact bytes',async()=>{
   const r=await coi(app,copyId,'sketch.export-image',{fileName:'lifecycle.png',base64:Buffer.from(options.png).toString('base64')},'life-sketch-export');assert.equal(r.status,200,JSON.stringify(r.data));const target=new URL(r.data.data.result.url,'http://fixture.invalid');const file=await req(app,target.pathname+target.search);assert.equal(file.status,200,JSON.stringify(file.data));assert.equal(hash(file.bytes),hash(options.png));const guest=await req(app,target.pathname+target.search,{sso:''});assert([401,403].includes(guest.status),'private export must reject missing credentials, got '+guest.status);const foreign=await req(app,target.pathname+target.search,{instance:'mai-sketch-alt'});assert([403,404].includes(foreign.status),'private export must reject a different MA instance, got '+foreign.status);report.exportSha256=hash(file.bytes);report.exportPath=target.pathname+target.search;
  });
  let archivedRevision=0;
  if(await check(app+': Provider archive returns a durable replayable result',async()=>{
   const r=await provider(app+'.archive',{},'life-'+app+'-provider-archive',sourceRevision);assert.equal(r.status,200,JSON.stringify(r.data));archivedRevision=r.data.revision;report.archivedRevision=archivedRevision;
   const replay=await provider(app+'.archive',{},'life-'+app+'-provider-archive',sourceRevision);assert.equal(replay.status,200,JSON.stringify(replay.data));assert.equal(replay.data.revision,archivedRevision);
  })){} // Restoration is still attempted when archive replay exposes a defect.
  await check(app+': archived audit reads follow the App profile and reject anonymous/other-instance access',async()=>{
   assert(archivedRevision>0);const audit=await coi(app,sourceId,app+'.read',{},'life-'+app+'-archive-audit-read');assert.equal(audit.status,200,JSON.stringify(audit.data));assert.equal(audit.data.data.result.content,sourceContent);
   const path=`/api/apps/${app}/instances/${sourceId}/state`;const own=await state(app,sourceId);assert(own.meta.archivedAt);assert.equal(own.content,sourceContent);
   const guest=await req(app,path,{sso:''});assert([401,403].includes(guest.status),'Archived state must reject anonymous access, got '+guest.status);
   const other=await req(app,path,{instance:'mai-'+app+'-alt'});assert([403,404].includes(other.status),'Archived state must reject another MA instance, got '+other.status);
   const hidden=await provider(app+'.read',{},'life-'+app+'-archive-provider-read');assert.equal(hidden.status,app==='doc'?200:404,JSON.stringify(hidden.data));if(app==='doc')assert.equal(hidden.data.data.content,sourceContent);
   report.archivedAccess={authorizedByIdRead:audit.status,anonymousState:guest.status,otherInstanceState:other.status,normalProviderLookup:hidden.status,contentSha256:hash(own.content)};
  });
  await check(app+': Provider restore preserves canonical instance discovery and original-key recovery',async()=>{
   assert(archivedRevision>0);const r=await provider(app+'.restore',{},'life-'+app+'-provider-restore',archivedRevision);report.providerRestoreStatus=r.status;assert.equal(r.status,200,JSON.stringify(r.data));
   const read=await provider(app+'.read',{},'life-'+app+'-read-restored');report.providerReadAfterRestoreStatus=read.status;assert.equal(read.status,200,JSON.stringify(read.data));assert.equal(read.data.data.meta.id,sourceId);assert.equal(read.data.data.content,sourceContent);
   const replay=await provider(app+'.restore',{},'life-'+app+'-provider-restore',archivedRevision);assert.equal(replay.status,200,JSON.stringify(replay.data));assert.equal(replay.data.revision,r.data.revision);
   const before=await state(app,sourceId);const noOp=await provider(app+'.restore',{},'life-'+app+'-active-restore',read.data.revision);assert.equal(noOp.status,200,JSON.stringify(noOp.data));const after=await state(app,sourceId);for(const field of ['providerRevision','updatedAt','nodeId','mirrorCanvasId','mirrorPath'])assert.deepEqual(after.meta[field],before.meta[field]);assert.equal(after.content,before.content);
  });
  report.sourceState=await state(app,sourceId);report.copyState=await state(app,copyId);
  states.set(app,{sourceId,copyId,sourceContent,copyContent,restoreBody,restoreKey,restoreReceipt,readProvider:()=>provider(app+'.read',{},'life-'+app+'-read-after-restart')});
 }
 return{checks,failures,evidence,async postRestart(){
  for(const [app,s]of states)await check(app+': copied bytes, private export and restore receipt survive service restart',async()=>{
   const source=await state(app,s.sourceId),copy=await state(app,s.copyId);assert.equal(source.content,s.sourceContent);assert.equal(copy.content,s.copyContent);assert(!copy.meta.archivedAt);const provider=await s.readProvider();assert.equal(provider.status,200,JSON.stringify(provider.data));assert.equal(provider.data.data.meta.id,s.sourceId);assert.equal(provider.data.data.content,s.sourceContent);
   const replay=await coi(app,s.copyId,app+'.restore',s.restoreBody,s.restoreKey);assert.equal(replay.status,200,JSON.stringify(replay.data));assert.equal(replay.data.data.replayed,true);assert.equal(replay.data.data.receiptId,s.restoreReceipt);
   if(app==='sketch'&&evidence.sketch.exportPath){const file=await req(app,evidence.sketch.exportPath);assert.equal(file.status,200);assert.equal(hash(file.bytes),evidence.sketch.exportSha256);}
  });
 }};
}
