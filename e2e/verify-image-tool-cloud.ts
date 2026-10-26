/** Explicit cloud acceptance: synthetic input/model fixture, real Appwrite files/tasks and restart. No paid inference. Creates an isolated proof canvas and runtime namespace. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createCanvasServer} from '../apps/server/src/server.js';
import {AppwriteClient} from '../apps/server/src/storage/appwrite-client.js';
const require=createRequire(new URL('../apps/server/package.json',import.meta.url));
const sharp=require('sharp') as typeof import('sharp').default;
const {createImageToolExecutor}=await import('../apps/server/node_modules/@ks-designai/image-card-pack/dist/backend/executor.js');
const {imageCatalog}=await import('../apps/server/node_modules/@ks-designai/image-card-pack/dist/generation.js');
const {values}=parseArgs({options:{prefs:{type:'string'},'cache-dir':{type:'string'},report:{type:'string'}}});
for(const key of ['prefs','cache-dir','report'] as const)if(!values[key]||!path.isAbsolute(values[key]!))throw Error(`Pass absolute --${key}`);
const prefs=JSON.parse(await readFile(values.prefs!,'utf8'));
const session=/a_session_console=([^;,\s]+)/u.exec(prefs[prefs.current].cookie)?.[1];if(!session)throw Error('No maintenance session');
const endpoint='https://frontend-cloud.corp.kuaishou.com/v1',cookie=`a_session_console=${session}`;
const id=`image-backend-proof-${Date.now()}`;let calls=0;
const executor=createImageToolExecutor({credentialProvider:async()=> 'fixture-only-no-billing',fetcher:async(_url,init)=>{
 calls++;const request=JSON.parse(String(init?.body));if(!request.prompt.includes('RELIGHT ONLY'))throw Error('Prompt migration failed');
 const result=await sharp({create:{width:64,height:48,channels:3,background:'#ff9933'}}).png().toBuffer();
 return Response.json({images:[{data:`data:image/png;base64,${result.toString('base64')}`,mimeType:'image/png'}]});
}});
async function start(index:number){const api=createCanvasServer({dataRoot:path.join(values['cache-dir']!,`${id}-${index}`),developmentActor:{teamId:'local',userId:'maintenance'},appwrite:{endpoint,projectId:'grworkspace',databaseId:'canvas_app_dev',bucketId:'canvas_assets_v2',sessionCookie:cookie,sessionMode:'admin',runtime:{collectionId:'app_runtime_state',namespace:id,singleWriter:true,...(index===0?{initialize:true}:{})}},media:{catalog:async()=>imageCatalog,config:async()=>({providers:{designai:{configured:true}}}),generate:async input=>{const result=await executor(input);if(result.artifacts.length!==1)throw Error('wrong artifact count');return {path:String(input.request.output),...result.artifacts[0]};}}});await api.ready;const listener=api.app.listen(0,'127.0.0.1');await new Promise<void>(r=>listener.once('listening',r));const address=listener.address() as {port:number};return{api,listener,base:`http://127.0.0.1:${address.port}`,async close(){await new Promise<void>(r=>listener.close(()=>r()));await api.close();}};}
let runtime=await start(0);
async function json(url:string,init?:RequestInit){const res=await fetch(runtime.base+url,init);const value=await res.json();if(!res.ok)throw Error(JSON.stringify(value));return value.data??value;}
const post=(value:unknown,key?:string)=>({method:'POST',headers:{'content-type':'application/json',...(key?{'idempotency-key':key}:{})},body:JSON.stringify(value)});
try {
 await json('/api/apps/canvas/actions/canvas.create',post({input:{instanceId:id,name:'图片工具后端云存储验收'}},'create-proof'));
 const png=await sharp({create:{width:80,height:60,channels:3,background:'#228855'}}).png().toBuffer();
 const form=new FormData();form.append('files',new Blob([new Uint8Array(png)],{type:'image/png'}),'source.png');
 const upload=await json(`/api/projects/${id}/upload`,{method:'POST',body:form});
 const state=await json(`/api/apps/canvas/instances/${id}/state`);
 await json(`/api/apps/canvas/instances/${id}/operations`,post({operationId:'attach-source',baseRevision:state.revision,operations:[{type:'image.attach',nodeId:'source',source:{path:upload.files[0].name},x:0,y:0}]}));
 const before=await json(`/api/apps/image/instances/${id}/state`);
 const sourceBefore=before.cards.find((c:{nodeId:string})=>c.nodeId==='source').node;
 const request={input:{nodeId:'source',kind:'relight',params:{azimuth:-45,elevation:25,brightness:50,color:'#ffffff',rim:false,smart:false}},expectedRevision:before.revision};
 const receipt=await json(`/api/apps/image/instances/${id}/actions/image.tool`,post(request,'relight-once'));
 const taskId=receipt.result.taskIds[0];const task=await runtime.api.media.wait(taskId,AbortSignal.timeout(30000));
 if(task?.status!=='done')throw Error(JSON.stringify(task));await runtime.api.media.delivery.reconcile();
 const replay=await json(`/api/apps/image/instances/${id}/actions/image.tool`,post(request,'relight-once'));if(!replay.replayed||calls!==1)throw Error('Duplicate paid dispatch');
 const client=new AppwriteClient({endpoint,projectId:'grworkspace',sessionCookie:cookie,sessionMode:'admin'});
 const row=await client.call<{state:string;revision:number}>('GET',`${client.docsPath('canvas_app_dev','canvases')}/${id}`);
 const cloud=JSON.parse(row.state),original=cloud.workbenchImages.find((v:{id:string})=>v.id==='source'),result=cloud.workbenchImages.find((v:{taskId:string})=>v.taskId===taskId);
 for(let i=0;i<100&&!result.path;i++){await new Promise(r=>setTimeout(r,100));const s=await runtime.api.canvas.read(id);const latest=s.state.workbenchImages as Array<{taskId:string;path?:string}>;Object.assign(result,latest.find(v=>v.taskId===taskId));}
 if(original.path!==sourceBefore.path||!result.path)throw Error(JSON.stringify({message:'Original lost or output absent',original:original.path,expected:sourceBefore.path,result,task}));
 const bytes=await (await fetch(`${runtime.base}/api/projects/${id}/files/${result.path}`)).arrayBuffer();const meta=await sharp(Buffer.from(bytes)).metadata();if(meta.width!==80||meta.height!==60)throw Error('Dimensions not restored');
 await runtime.close();runtime=await start(1);
 const restored=await json(`/api/apps/image/instances/${id}/action-receipts/relight-once`);
 if(restored.status!=='succeeded'||restored.result.taskIds[0]!==taskId)throw Error('Cloud receipt did not restore');
 const report={verifiedAt:new Date().toISOString(),projectId:id,storage:'real Appwrite grworkspace/canvas_app_dev and canvas_assets_v2',model:'HTTP fixture; no real model or GPU billing',tool:'relight',taskId,original:original.path,result:{path:result.path,width:meta.width,height:meta.height,bytes:bytes.byteLength},calls,replayed:replay.replayed,restoredReceipt:restored.status,checks:['original retained','real cloud PNG readback','tool restored source dimensions','idempotency charged once in fixture','receipt and task restored from cloud after fresh cache restart'],notClaimed:['real upstream image semantics','GPU/layering/mockup service','all tool UI','formal MA/staging']};
 await mkdir(path.dirname(values.report!),{recursive:true});await writeFile(values.report!,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await runtime.close();}
