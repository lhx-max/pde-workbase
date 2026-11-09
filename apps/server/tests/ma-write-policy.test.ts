import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer,type Server} from 'node:http';
import {createCanvasServer,type CanvasServer} from '../src/server.js';
import {createAppWriteAuthorizer,type AppActor} from '@ks-designai/app-authority';
import {insertMediaTask,updateMediaTask} from '../src/media/tasks.js';
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});
const listen=(s:Server)=>new Promise<string>(resolve=>s.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${(s.address() as {port:number}).port}`)));
const stop=(s:Server)=>new Promise<void>(resolve=>{s.close(()=>resolve());s.closeAllConnections();});
async function fixture(policy?:(actor:AppActor,action:string)=>boolean,trustedAppOrigins?:string[],independentImage?:{origin:string;applicationId:string}){
 const root=await mkdtemp(path.join(tmpdir(),'ma-write-test-'));let api:CanvasServer;
 let revoked=false;let applicationId='app_canvas',providerInstanceId='provider';
 const fetcher:typeof fetch=async input=>revoked?new Response('{}',{status:403}):new Response(JSON.stringify({data:String(input).endsWith('/me')?{userId:'reader',status:'active'}:{applicationInstanceId:'ma-instance',providerInstanceId,applicationId,bizId:'business',status:'active'}}),{status:200,headers:{'content-type':'application/json'}});
 api=createCanvasServer({dataRoot:root,trustedAppOrigins,...(independentImage?{independentImage}:{}),authority:{transport:{origin:'http://127.0.0.1:1'},fetcher},...(policy?{authorizeAction:policy}:{})});await api.ready;
 const s=createServer(api.app);const base=await listen(s);
 cleanup.push(async()=>{await stop(s);await api.close();await rm(root,{recursive:true,force:true});});
 api.registry.create({id:'existing',name:'Existing',teamId:'team',metadata:{kind:'other',appAuthority:{bizId:'business',applicationId:'app_canvas',providerInstanceId:'provider',applicationInstanceId:'ma-instance'}}});
 const request=(route:string,method='GET',body?:unknown)=>fetch(base+route,{method,headers:{'content-type':'application/json','x-mav-sso-authorization':'Bearer valid','x-mav-tenant':'team','x-mav-application-instance-id':'ma-instance'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 return{request,api,revoke:()=>{revoked=true;},rebind:(field:'applicationId'|'providerInstanceId')=>{if(field==='applicationId')applicationId='other-app';else providerInstanceId='other-provider';}};
}
it('keeps MA-readable canvases read-only when no write policy is configured',async()=>{
 const f=await fixture();
 expect((await f.request('/api/apps/canvas/instances/existing/state')).status).toBe(200);
 for(const [route,body] of [
 ['/api/apps/canvas/actions/canvas.create',{input:{instanceId:'another',name:'Denied'}}],
 ['/api/apps/canvas/instances/existing/operations',{operationId:'no',baseRevision:0,operations:[]}],
 ['/api/projects/existing/media/generate',{surface:'image',model:'must-not-call'}],
 ] as const){const response=await f.request(route,'POST',body);expect(response.status).toBe(403);expect((await response.json() as {error:{code:string}}).error.code).toBe('APP_WRITE_FORBIDDEN');}
});
it('lets a verified reader wait on media without granting cancellation or retry',async()=>{
 const f=await fixture();
 f.api.db.prepare('INSERT OR IGNORE INTO projects(id) VALUES (?)').run('existing');
 const task=insertMediaTask(f.api.db,{id:'read-only-task',projectId:'existing',surface:'image',model:'offline-read-fixture'});
 updateMediaTask(f.api.db,task.id,{status:'done',endedAt:Date.now()});
 for(const route of [`/api/media/tasks/${task.id}`,`/api/projects/existing/media/tasks/${task.id}`]){
  expect((await f.request(route)).status).toBe(200);
  const waited=await f.request(route+'/wait','POST',{timeoutMs:100});
  expect(waited.status).toBe(200);
  expect(await waited.json()).toMatchObject({taskId:task.id,status:'done'});
  expect((await f.request(route+'/cancel','POST',{})).status).toBe(403);
  expect((await f.request(route+'/retry','POST',{})).status).toBe(403);
 }
 expect((await f.request('/api/projects/existing/other/wait','POST',{})).status).toBe(403);
});
it('grants exact actions only after MA verification',async()=>{
 const f=await fixture(createAppWriteAuthorizer(JSON.stringify([{teamId:'team',userId:'reader',bizId:'business',applicationId:'app_canvas',applicationInstanceId:'ma-instance',actions:['canvas.create']}])));
 const created=await f.request('/api/apps/canvas/actions/canvas.create','POST',{input:{instanceId:'created',name:'Granted'}});expect(created.status).toBe(201);
 const receiptId=(await created.json() as {data:{receiptId:string}}).data.receiptId;expect(receiptId).toMatch(/^car-/);
 expect((await f.request(`/api/apps/canvas/action-receipts/${receiptId}`,'GET')).status).toBe(200);
 expect((await f.request('/api/apps/canvas/actions/canvas.create','POST',{input:{instanceId:'created',name:'Granted'}})).status).toBe(409);
 expect((await f.request('/api/apps/canvas/instances/existing/operations','POST',{operationId:'no',baseRevision:0,operations:[]})).status).toBe(403);
});

it('never sends MA credentials to a tenant-registered untrusted origin',async()=>{
 let calls=0;
 const upstream=createServer((_req,res)=>{calls++;res.end('{}');});const origin=await listen(upstream);cleanup.push(()=>stop(upstream));
 const f=await fixture();
 expect((await f.request('/api/apps/register','POST',{appId:'untrusted',name:'Untrusted',endpoint:origin,scope:'team'})).status).toBe(201);
 const result=await f.request('/api/apps/untrusted/instances');expect(result.status).toBe(403);expect(calls).toBe(0);
});
it('forwards request-bound MA credentials only to an explicitly trusted origin',async()=>{
 let credential:string|undefined;
 const upstream=createServer((req,res)=>{credential=String(req.headers['x-mav-sso-authorization']);res.setHeader('content-type','application/json');res.end('{"data":{}}');});const origin=await listen(upstream);cleanup.push(()=>stop(upstream));
 const f=await fixture(undefined,[origin]);
 expect((await f.request('/api/apps/register','POST',{appId:'trusted',name:'Trusted',endpoint:origin,scope:'team'})).status).toBe(201);
 expect((await f.request('/api/apps/trusted/instances')).status).toBe(200);expect(credential).toBe('Bearer valid');
});

it('rejects provider endpoint credentials and secret query strings before persistence or audit',async()=>{
 const f=await fixture();
 for(const endpoint of ['https://user:private-password@provider.example/api/apps/doc','https://provider.example/api/apps/doc?token=private-token','https://provider.example/api/apps/doc#private-fragment']){
  const response=await f.request('/api/apps/register','POST',{appId:'unsafe-provider',name:'Unsafe',scope:'team',endpoint});
  expect(response.status).toBe(400);expect(await response.text()).not.toContain('private-');
 }
});

it('revalidates MA access before sending content on an already-open card stream',async()=>{
 const f=await fixture();const response=await f.request('/api/apps/canvas/instances/existing/events');expect(response.status).toBe(200);
 const reader=response.body!.getReader();const first=await reader.read();expect(new TextDecoder().decode(first.value)).toContain('event: ready');
 f.revoke();await f.api.canvas.applyOperations('existing',{operationId:'another-writer-update',baseRevision:0,operations:[{type:'node.create',node:{id:'private-update',kind:'text',x:0,y:0,text:'must-not-stream-after-revocation'}}]});
 let output='';for(let index=0;index<5;index++){const next=await reader.read();if(next.done)break;output+=new TextDecoder().decode(next.value);}
 expect(output).not.toContain('private-update');expect(output).not.toContain('must-not-stream');
});

it('does not expose a canvas when MA rebinds the same instance id to another app or provider',async()=>{
 for(const field of ['applicationId','providerInstanceId'] as const){
  const f=await fixture();expect((await f.request('/api/apps/canvas/instances/existing/state')).status).toBe(200);f.rebind(field);
  expect((await f.request('/api/apps/canvas/instances/existing/state')).status).toBe(403);
  const list=await(await f.request('/api/apps/canvas/instances')).json() as {data:{instances:Array<{instanceId:string}>}};
  expect(list.data.instances.some(p=>p.instanceId==='existing')).toBe(false);
 }
});
it('does not auto-adopt a partial legacy canvas MA mapping',async()=>{
 const f=await fixture();f.api.registry.create({id:'legacy-partial',name:'Legacy',teamId:'team',metadata:{kind:'other',appAuthority:{bizId:'business',applicationInstanceId:'ma-instance'}}});
 expect((await f.request('/api/apps/canvas/instances/legacy-partial/state')).status).toBe(403);
});

it('independent Image profile refuses legacy paid submissions before reserving a Canvas task',async()=>{
 const origin='http://127.0.0.1:9';
 const f=await fixture(()=>true,[origin],{origin,applicationId:'image'});
 for(const surface of ['image',undefined,['image']]){
 const response=await f.request('/api/projects/existing/media/generate','POST',{surface,model:'never-dispatch',prompt:'probe'});
 expect(response.status).toBe(409);
 expect(await response.json()).toMatchObject({error:{code:'IMAGE_APP_REQUIRED'}});
 }
 expect(f.api.media.list('existing',true)).toEqual([]);
 const legacy=await f.request('/api/apps/image/instances/existing/actions/image.generate','POST',{input:{nodeId:'legacy'}});
 expect(legacy.status).not.toBe(202);
 expect(f.api.media.list('existing',true)).toEqual([]);
});
