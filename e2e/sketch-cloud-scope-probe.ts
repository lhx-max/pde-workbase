/** Real Sketch Appwrite acceptance. MA authority is an owned fixture, no real MA/Agent claim. */
import {createServer,type Server} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {parseArgs} from 'node:util';
import assert from 'node:assert/strict';
import {AppwriteWriterLock} from '../packages/app-cloud-state/src/index.js';
const{values}=parseArgs({options:{prefs:{type:'string'},repo:{type:'string'},output:{type:'string'}}});
for(const key of ['prefs','repo','output'] as const)if(!values[key]||!path.isAbsolute(values[key]!))throw Error('Absolute '+key+' required');
const prefs=JSON.parse(await readFile(values.prefs!,'utf8'));
const config={endpoint:'https://frontend-cloud.corp.kuaishou.com/v1',projectId:'grworkspace',sessionCookie:prefs[prefs.current].cookie,sessionMode:'admin' as const};
const moduleOf=(name:string)=>import(pathToFileURL(path.join(values.repo!,'apps/server/src',name+'.ts')).href);
const[{AppwriteClient},{AppwriteSketchStore},{createApp}]=await Promise.all(['appwrite-client','appwrite-store','app'].map(moduleOf));
const stamp=String(Date.now()),team='sketch-scope-'+stamp,biz='business-'+stamp;
const bucket='sketch_assets_v2',database='sketch_app_dev',filesBase='/storage/buckets/'+bucket+'/files';
const ownFiles=new Set<string>(),ownDocs=new Set<string>(),servers=new Set<Server>();let businessWrites=0,allowWrites=true,revoked=false;
const checks:string[]=[],cleanup:Array<{id:string;deleted?:boolean;retainedShared?:boolean}>=[];
const check=(name:string,ok:boolean)=>{assert(ok,name);checks.push(name);};
class TrackedClient extends AppwriteClient{
 async call<T>(method:string,url:string,body?:unknown,extra?:Record<string,string>):Promise<T>{
  const result=await super.call(method,url,body,extra);
  if(method==='POST'&&url===filesBase&&body instanceof FormData){const id=body.get('fileId');if(typeof id==='string'&&(result as any)?.$id===id)ownFiles.add(id);}
  const input=body as {documentId?:string;data?:{teamId?:string}}|undefined;
  if(method==='POST'&&url===this.docsPath(database,'sketches')&&input?.data?.teamId===team){ownDocs.add(input.documentId!);businessWrites++;}
  return result as T;
 }
}
const client=new TrackedClient(config);
const lock=new AppwriteWriterLock({client,databaseId:database,collectionId:'app_runtime_state',serviceId:'sketch'});
const listen=(server:Server)=>new Promise<string>((resolve,reject)=>{servers.add(server);server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+(server.address() as {port:number}).port));});
const stop=async(server:Server)=>{if(!servers.delete(server))return;await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});};
const headers=(instance='instance-a',user='writer')=>({'content-type':'application/json','x-mav-sso-authorization':'Bearer '+user,'x-mav-tenant':team,'x-mav-application-instance-id':instance});
const ma=await listen(createServer((req,res)=>{
 res.setHeader('content-type','application/json');if(revoked){res.writeHead(403);res.end('{}');return;}
 const instance=decodeURIComponent(req.url?.split('/').pop()??'');
 const user=String(req.headers.authorization??'').replace('Bearer ','');
 res.end(JSON.stringify({data:req.url?.endsWith('/me')?{userId:user,status:'active'}:{applicationId:'sketch',applicationInstanceId:instance,providerInstanceId:'provider-'+instance,bizId:biz,status:'active'}}));
}));
const boot=async()=>{
 const store=new AppwriteSketchStore(client,database,bucket,{singleWriter:true});
 const server=createServer(createApp(store,{tenantResolver:{maAuthority:{transport:{origin:ma}}},authorizeWrite:(actor:any)=>allowWrites&&['writer','collaborator'].includes(actor.userId)}));
 return{store,server,base:await listen(server)};
};
const request=async(base:string,route:string,method='GET',body?:unknown,instance='instance-a',user='writer',key?:string)=>{
 const response=await fetch(base+route,{method,headers:{...headers(instance,user),...(key?{'idempotency-key':key}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const text=await response.text();let data:any;try{data=JSON.parse(text);}catch{data=text;}return{status:response.status,body:data};
};
let failure:string|undefined;
try{
 await lock.acquire();check('Canonical Sketch writer acquires its real exclusive cloud lock',true);
 const first=await boot(),createKey='create-'+stamp,body={input:{name:'Cloud sketch scope '+stamp}};
 const created=await request(first.base,'/api/apps/sketch/actions/sketch.create','POST',body,'instance-a','writer',createKey);
 check('Authenticated Sketch create persists real scoped Appwrite metadata',created.status===200&&created.body.data?.result?.meta?.maApplicationInstanceId==='instance-a');
 const id=created.body.data.result.instanceId;assert(ownDocs.has(id));
 const state=await request(first.base,'/api/apps/sketch/instances/'+id+'/state');
 check('Sketch state reads canonical cloud scene and content revision',state.status===200&&typeof state.body.data.content==='string'&&/^[a-f0-9]{64}$/.test(state.body.data.revision));
 check('Same tenant/business/user but another MA instance cannot read the scene',(await request(first.base,'/api/apps/sketch/instances/'+id+'/state','GET',undefined,'instance-b')).status===403);
 const foreignList=await request(first.base,'/api/sketches','GET',undefined,'instance-b');
 check('MA instance B listing excludes instance A resources',foreignList.status===200&&!foreignList.body.data.items.some((item:any)=>item.id===id));
 check('MA instance B cannot read the cached creation receipt',(await request(first.base,'/api/apps/sketch/instances/'+id+'/action-receipts/'+createKey,'GET',undefined,'instance-b')).status===403);
 const before=businessWrites;
 const reader=await request(first.base,'/api/apps/sketch/actions/sketch.create','POST',body,'instance-a','reader','denied-'+stamp);
 check('A verified reader cannot create a cloud scene or business row',reader.status===403&&businessWrites===before);
 const scene=JSON.parse(state.body.data.content);scene.appState={...scene.appState,name:'Updated '+stamp};const changedContent=JSON.stringify(scene);
 const writeBody={input:{content:changedContent,baseContent:state.body.data.content,expectedRevision:state.body.data.revision}},writeKey='write-'+stamp;
 const written=await request(first.base,'/api/apps/sketch/instances/'+id+'/actions/sketch.write','POST',writeBody,'instance-a','writer',writeKey);
 check('Versioned Sketch write commits canonical changed bytes',written.status===200);
 await stop(first.server);const second=await boot();
 const reopened=await request(second.base,'/api/apps/sketch/instances/'+id+'/state');
 check('Fresh Sketch App/store reconstructs the updated scene and complete MA mapping',reopened.status===200&&reopened.body.data.content.includes('Updated '+stamp)&&reopened.body.data.meta.maApplicationId==='sketch'&&reopened.body.data.meta.maProviderInstanceId==='provider-instance-a');
 const replay=await request(second.base,'/api/apps/sketch/actions/sketch.create','POST',body,'instance-a','writer',createKey);
 check('Immutable cloud receipt replays create without a duplicate business row',replay.status===200&&replay.body.data.replayed===true&&replay.body.data.result.instanceId===id&&businessWrites===before);
 const changed=await request(second.base,'/api/apps/sketch/instances/'+id+'/actions/sketch.write','POST',{input:{...writeBody.input,content:'{}'}},'instance-a','writer',writeKey);
 check('Same write key with different input conflicts after restart',changed.status===409);
 const other=await request(second.base,'/api/apps/sketch/actions/sketch.create','POST',body,'instance-b','writer',createKey);
 check('Same key under another MA instance executes in an independent receipt scope',other.status===200&&other.body.data.result.instanceId!==id&&other.body.data.replayed===false);
 const collaborator=await request(second.base,'/api/apps/sketch/instances/'+id+'/state','GET',undefined,'instance-a','collaborator');
 check('Another authorized user in the same MA instance can collaborate',collaborator.status===200);
 const userCreate=await request(second.base,'/api/apps/sketch/actions/sketch.create','POST',body,'instance-a','collaborator',createKey);
 check('Idempotency scope also separates distinct calling users',userCreate.status===200&&userCreate.body.data.replayed===false&&userCreate.body.data.result.instanceId!==id);
 const archived=await request(second.base,'/api/apps/sketch/instances/'+id+'/actions/sketch.archive','POST',{input:{}},'instance-a','writer','archive-'+stamp);
 const restored=await request(second.base,'/api/apps/sketch/instances/'+id+'/actions/sketch.restore','POST',{input:{}},'instance-a','writer','restore-'+stamp);
 check('Archive/restore retains the exact verified MA resource tuple',archived.status===200&&restored.status===200&&(await second.store.meta(id)).maApplicationInstanceId==='instance-a');
 allowWrites=false;
 check('Revoking the current write grant blocks a previously successful create replay',(await request(second.base,'/api/apps/sketch/actions/sketch.create','POST',body,'instance-a','writer',createKey)).status===403);
 check('Revoking the current write grant blocks cached mutation receipt lookup',(await request(second.base,'/api/apps/sketch/instances/'+id+'/action-receipts/'+createKey)).status===403);
 revoked=true;check('Revoking MA membership blocks the next existing scene read',(await request(second.base,'/api/apps/sketch/instances/'+id+'/state')).status===403);
}catch(error){failure=error instanceof Error?error.message:String(error);}
finally{
 for(const server of [...servers])await stop(server);
 for(const id of ownDocs){await client.deleteOrNull(client.docsPath(database,'sketches')+'/'+id);cleanup.push({id,deleted:await client.getOrNull(client.docsPath(database,'sketches')+'/'+id)===null});}
 for(const id of ownFiles){
  if(id.startsWith('sk')){const q=AppwriteClient.query([AppwriteClient.eq('fileId',id),AppwriteClient.limit(1)]);const refs=await client.call<any>('GET',client.docsPath(database,'sketches')+'?'+q);if(refs.documents.length){cleanup.push({id,retainedShared:true});continue;}}
  await client.deleteOrNull(filesBase+'/'+id);cleanup.push({id,deleted:await client.getOrNull(filesBase+'/'+id)===null});
 }
 await lock.release();
 const report={checkedAt:new Date().toISOString(),passed:!failure&&cleanup.every(row=>row.deleted||row.retainedShared),storage:'real development Appwrite; existing bucket ACL is not production-private',identity:'owned MA authority fixture; not real MA or Agent acceptance',modelCalls:0,checks,cleanup,...(failure?{failure}:{})};
 await mkdir(path.dirname(values.output!),{recursive:true});await writeFile(values.output!,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,checks:checks.length,cleaned:cleanup.length,failure}));if(!report.passed)process.exitCode=1;
}
