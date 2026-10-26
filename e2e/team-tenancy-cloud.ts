/** Real Appwrite business data, with a loopback MA contract fixture for two
 * identities. This proves App-side isolation, NOT production MA SSO acceptance. */
import {createServer,type Server} from 'node:http';
import {readFile,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {createCanvasServer} from '../apps/server/src/server.js';
import {AppwriteClient} from '../apps/server/src/storage/appwrite-client.js';
import {CardRegistryStore} from '../apps/server/src/storage/card-registry.js';
const {values}=parseArgs({options:{prefs:{type:'string'},'doc-repo':{type:'string'},'output-dir':{type:'string'}}});
for(const key of ['prefs','doc-repo','output-dir'] as const)if(!values[key]||!path.isAbsolute(values[key]!))throw Error(`${key} must be absolute`);
const prefs=JSON.parse(await readFile(values.prefs!,'utf8'));const cookie=prefs[prefs.current]?.cookie;
if(typeof cookie!=='string'||!cookie.includes('a_session_console='))throw Error('Explicit maintenance session unavailable');
const config={endpoint:'https://frontend-cloud.corp.kuaishou.com/v1',projectId:'grworkspace',sessionCookie:cookie,sessionMode:'admin' as const};
const client=new AppwriteClient(config);const stamp=Date.now().toString();
const teams={a:`ct-a-${stamp}`,b:`ct-b-${stamp}`};
const actors={a:{teamId:teams.a,userId:'verified-user-a',bizId:'biz-a',instanceId:'ai_a'},b:{teamId:teams.b,userId:'verified-user-b',bizId:'biz-b',instanceId:'ai_b'},c:{teamId:teams.a,userId:'verified-user-c',bizId:'biz-c',instanceId:'ai_c'},d:{teamId:teams.a,userId:'verified-reader',bizId:'biz-a',instanceId:'ai_a'}};
const checks:Array<{name:string;passed:boolean}>=[];const cleanup:Array<{target:string;deleted:boolean}>=[];
const assert=(name:string,condition:boolean)=>{checks.push({name,passed:condition});if(!condition)throw Error(name);};
const listen=(server:Server)=>new Promise<string>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${(server.address() as {port:number}).port}`));});
const stop=(server:Server)=>new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});
const headers=(actor:keyof typeof actors,extras:Record<string,string>={})=>({'content-type':'application/json','x-mav-sso-authorization':`Bearer token-${actor}`,'x-mav-tenant':actors[actor].teamId,'x-mav-application-instance-id':actors[actor].instanceId,...extras});
const authority=createServer((req,res)=>{
 const key=(req.headers.authorization??'').replace('Bearer token-','') as keyof typeof actors;const actor=actors[key];
 res.setHeader('content-type','application/json');
 if(!actor){res.writeHead(401);res.end('{}');return;}
 if(req.headers['x-mav-tenant']!==actor.teamId){res.writeHead(403);res.end('{}');return;}
 if(req.url==='/api/ma-v/v1/me'){res.end(JSON.stringify({data:{userId:actor.userId,status:'active'}}));return;}
 if(req.url===`/api/ma-v/v1/application-instances/${actor.instanceId}`){res.end(JSON.stringify({data:{applicationInstanceId:actor.instanceId,applicationId:'app_canvas',providerInstanceId:`pid-${key}`,bizId:actor.bizId,status:'active'}}));return;}
 res.writeHead(403);res.end('{}');
});
const ma=await listen(authority);const authorityOptions={transport:{origin:ma}};
const cache=await mkdtemp(path.join(tmpdir(),'canvas-team-cloud-'));
const ids=[`tenant-${stamp}-a`,`tenant-${stamp}-b`];
const grants=new CardRegistryStore(client,'canvas_app_dev');
let canvas:ReturnType<typeof createCanvasServer>|undefined;let canvasHttp:Server|undefined;let docHttp:Server|undefined;
let docId:string|undefined;const docFiles=new Set<string>();let failure:string|undefined;
const request=async(base:string,actor:keyof typeof actors,method:string,route:string,body?:unknown,extra?:Record<string,string>)=>{
 const response=await fetch(base+route,{method,headers:headers(actor,extra),...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:response.status,body:await response.json() as any};
};
try{
 await grants.upsertGrant({scope:`team:${teams.a}`,allowedKinds:['storyboard'],source:'local'});
 await grants.upsertGrant({scope:`team:${teams.b}`,allowedKinds:['video'],source:'local'});
 canvas=createCanvasServer({dataRoot:path.join(cache,'first'),appwrite:{...config,databaseId:'canvas_app_dev',bucketId:'canvas_assets_v2'},authority:authorityOptions,authorizeAction:actor=>actor.userId==='verified-user-a'||actor.userId==='verified-user-b'});await canvas.ready;
 canvasHttp=createServer(canvas.app);let base=await listen(canvasHttp);
 for(const [i,actor] of ['a','b'].entries()){
  const created=await request(base,actor as 'a'|'b','POST','/api/apps/canvas/actions/canvas.create',{input:{name:`Team ${actor}`,instanceId:ids[i]}});
  assert(`Team ${actor} creates cloud canvas`,created.status===201);
 }
 for(const [i,actor,kind] of [[0,'a','storyboard'],[1,'b','video']] as const){
  const caps=await request(base,actor,'GET',`/api/apps/canvas/instances/${ids[i]}/capabilities`);
  assert(`Team ${actor} receives only its allowed creation kinds`,caps.status===200&&JSON.stringify(caps.body.data.allowedKinds)===JSON.stringify([kind]));
  const written=await request(base,actor,'POST',`/api/apps/canvas/instances/${ids[i]}/operations`,{operationId:`seed-${actor}`,baseRevision:0,operations:[{type:'node.create',node:{id:`node-${actor}`,kind,x:0,y:0,title:`team-${actor}`}}]});
  assert(`Team ${actor} writes its allowed card`,written.status===200);
 }
 const denied=await request(base,'b','POST',`/api/apps/canvas/instances/${ids[1]}/operations`,{operationId:'blocked-kind',baseRevision:0,operations:[{type:'node.create',node:{id:'blocked',kind:'text',x:0,y:0}}]});
 assert('Denied native kind is rejected by backend',denied.status===403&&denied.body.error.code==='CARD_KIND_NOT_ALLOWED');
 assert('Verified same-instance reader can read cloud canvas',(await request(base,'d','GET',`/api/apps/canvas/instances/${ids[0]}/state`)).status===200);
 assert('Verified reader cannot mutate cloud canvas',(await request(base,'d','POST',`/api/apps/canvas/instances/${ids[0]}/operations`,{operationId:'reader-denied',baseRevision:0,operations:[]})).status===403);
 assert('Team B cannot read Team A canvas',(await request(base,'b','GET',`/api/apps/canvas/instances/${ids[0]}/state`)).status===403);
 assert('Spoofed development headers cannot change verified identity',(await request(base,'b','GET',`/api/apps/canvas/instances/${ids[0]}/state`,undefined,{'x-team-id':teams.a,'x-user-id':'verified-user-a'})).status===403);
 assert('SSO tenant mismatch rejected upstream',(await request(base,'b','GET',`/api/apps/canvas/instances/${ids[0]}/state`,undefined,{'x-mav-tenant':teams.a})).status===403);
 assert('Same tenant but another MA business space cannot read asset',(await request(base,'c','GET',`/api/apps/canvas/instances/${ids[0]}/state`)).status===403);
 const anonymous=await fetch(base+`/api/apps/canvas/instances/${ids[0]}/state`,{headers:{'x-team-id':teams.a,'x-user-id':'verified-user-a'}});
 assert('Self-reported identity without SSO rejected',anonymous.status===401);
 assert('Denied image generation is rejected before calling an adapter',(await request(base,'a','POST',`/api/projects/${ids[0]}/media/generate`,{surface:'image',model:'not-called'})).status===403);
 assert('Ordinary member cannot change shared provider configuration',(await request(base,'a','PUT','/api/media/config',{providers:{}})).status===403);
 const row=await client.call<Record<string,any>>('GET',`${client.docsPath('canvas_app_dev','canvases')}/${ids[0]}`);
 assert('Cloud canvas row records verified team and creator',row.teamId===teams.a&&row.createdBy==='verified-user-a'&&JSON.parse(row.assetMetadata).metadata.appAuthority.bizId==='biz-a');
 await stop(canvasHttp);canvasHttp=undefined;await canvas.close();canvas=undefined;
 canvas=createCanvasServer({dataRoot:path.join(cache,'empty-after-restart'),appwrite:{...config,databaseId:'canvas_app_dev',bucketId:'canvas_assets_v2'},authority:authorityOptions,authorizeAction:actor=>actor.userId==='verified-user-a'||actor.userId==='verified-user-b'});await canvas.ready;
 canvasHttp=createServer(canvas.app);base=await listen(canvasHttp);
 const recovered=await request(base,'a','GET',`/api/apps/canvas/instances/${ids[0]}/state`);
 assert('Empty cache restart recovers original cloud state and ownership',recovered.status===200&&recovered.body.data.state.workbenchBasicNodes[0].id==='node-a');
 const listed=await request(base,'a','GET','/api/apps/canvas/instances');
 assert('Instance list excludes foreign team and business space',listed.status===200&&listed.body.data.instances.length===1&&listed.body.data.instances[0].instanceId===ids[0]);
 const {AppwriteClient:DocClient}=await import(pathToFileURL(path.join(values['doc-repo']!,'apps/server/src/appwrite-client.ts')).href);
 const {AppwriteDocStore}=await import(pathToFileURL(path.join(values['doc-repo']!,'apps/server/src/appwrite-store.ts')).href);
 const {createApp}=await import(pathToFileURL(path.join(values['doc-repo']!,'apps/server/src/app.ts')).href);
 const docClient=new DocClient(config);let docStore=new AppwriteDocStore(docClient,'doc_app_dev','doc_assets_v2',{singleWriter:true});
 docHttp=createServer(createApp(docStore,{auth:{maAuthority:authorityOptions},authorizeWrite:(actor:{userId:string})=>actor.userId==='verified-user-a'}));let docBase=await listen(docHttp);
 const createdDoc=await request(docBase,'a','POST','/api/documents',{name:`Cloud tenant probe ${stamp}`});docId=createdDoc.body.data?.id;
 assert('Verified document reader cannot create',(await request(docBase,'d','POST','/api/documents',{name:'Must not create'})).status===403);
 assert('Document App creates cloud-owned document',createdDoc.status===201&&typeof docId==='string'&&createdDoc.body.data.teamId===teams.a&&createdDoc.body.data.bizId==='biz-a');
 let docRow=await client.call<Record<string,any>>('GET',`${client.docsPath('doc_app_dev','documents')}/${docId}`);docFiles.add(docRow.fileId);
 const read=await request(docBase,'a','GET',`/api/apps/doc/instances/${encodeURIComponent(docId!)}/state`);
 const saved=await request(docBase,'a','POST',`/api/apps/doc/instances/${encodeURIComponent(docId!)}/actions/doc.write`,{input:{content:`Verified cloud document ${stamp}`,expectedRevision:read.body.data.revision}});
 assert('Document edit and cloud save succeeds',saved.status===200);
 docRow=await client.call<Record<string,any>>('GET',`${client.docsPath('doc_app_dev','documents')}/${docId}`);docFiles.add(docRow.fileId);
 assert('Document cloud row persists ownership',docRow.teamId===teams.a&&docRow.createdBy==='verified-user-a'&&docRow.bizId==='biz-a');
 assert('Team B cannot read Team A document',(await request(docBase,'b','GET',`/api/apps/doc/instances/${encodeURIComponent(docId!)}/state`)).status===403);
 assert('Same tenant foreign MA space cannot read document',(await request(docBase,'c','GET',`/api/apps/doc/instances/${encodeURIComponent(docId!)}/state`)).status===403);
 assert('Team B cannot overwrite Team A document',(await request(docBase,'b','POST',`/api/apps/doc/instances/${encodeURIComponent(docId!)}/actions/doc.write`,{input:{content:'forbidden',expectedRevision:saved.body.data.result?.revision}})).status===403);
 const docAnonymous=await fetch(docBase+`/api/apps/doc/instances/${encodeURIComponent(docId!)}/state`,{headers:{'x-team-id':teams.a,'x-user-id':'verified-user-a'}});
 assert('Document App rejects self-reported identity without MA credential',docAnonymous.status===401);
 await stop(docHttp);docHttp=undefined;
 docStore=new AppwriteDocStore(new DocClient(config),'doc_app_dev','doc_assets_v2',{singleWriter:true});
 docHttp=createServer(createApp(docStore,{auth:{maAuthority:authorityOptions},authorizeWrite:(actor:{userId:string})=>actor.userId==='verified-user-a'}));docBase=await listen(docHttp);
 const docRecovered=await request(docBase,'a','GET',`/api/apps/doc/instances/${encodeURIComponent(docId!)}/state`);
 assert('New document service recovers exact cloud content',docRecovered.status===200&&docRecovered.body.data.content===`Verified cloud document ${stamp}`);
}catch(error){failure=error instanceof Error?error.message:'Cloud tenancy verification failed';}
finally{
 if(docHttp)await stop(docHttp);if(canvasHttp)await stop(canvasHttp);if(canvas)await canvas.close();await stop(authority);
 const remove=async(target:string,route:string)=>{try{await client.call('DELETE',route);cleanup.push({target,deleted:true});}catch{cleanup.push({target,deleted:false});}};
 for(const id of ids){
  for(const collection of ['canvas_operations','canvas_files']){
   const rows=await client.call<{documents:Array<{$id:string}>}>('GET',`${client.docsPath('canvas_app_dev',collection)}?${AppwriteClient.query([AppwriteClient.eq('canvasId',id),AppwriteClient.limit(100)])}`);
   for(const row of rows.documents)await remove(`${collection}:${row.$id}`,`${client.docsPath('canvas_app_dev',collection)}/${row.$id}`);
  }
  const route=`${client.docsPath('canvas_app_dev','canvases')}/${id}`;if(await client.getOrNull(route))await remove(id,route);
 }
 for(const team of Object.values(teams)){
  const rows=await client.call<{documents:Array<{$id:string}>}>('GET',`${client.docsPath('canvas_app_dev','card_grants')}?${AppwriteClient.query([AppwriteClient.eq('scope',`team:${team}`),AppwriteClient.limit(100)])}`);
  for(const row of rows.documents)await remove(`grant:${team}`,`${client.docsPath('canvas_app_dev','card_grants')}/${row.$id}`);
 }
 if(docId)await remove(`document:${docId}`,`${client.docsPath('doc_app_dev','documents')}/${encodeURIComponent(docId)}`);
 for(const id of docFiles)await remove(`doc-file:${id}`,`/storage/buckets/doc_assets_v2/files/${id}`);
 await rm(cache,{recursive:true,force:true});
 await mkdir(values['output-dir']!,{recursive:true});
 const report={verifiedAt:new Date().toISOString(),storage:'real Appwrite grworkspace development collections/buckets',authority:'isolated MA contract fixture, not production MA SSO acceptance',passed:!failure&&cleanup.every(item=>item.deleted),checks,cleanup,...(failure?{failure}:{})};
 await writeFile(path.join(values['output-dir']!,'runtime.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
}
