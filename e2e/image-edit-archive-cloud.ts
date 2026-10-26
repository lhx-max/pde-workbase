/** Focused real-cloud edit/receipt recovery. No model or provider calls. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';import {createRequire} from 'node:module';import path from 'node:path';
import {createCanvasServer} from '../apps/server/src/server.js';
const require=createRequire(new URL('../apps/server/package.json',import.meta.url));const sharp=require('sharp') as typeof import('sharp').default;
const {imageCatalog}=await import('../apps/server/node_modules/@ks-designai/image-card-pack/dist/generation.js');
const prefs=JSON.parse(await readFile('/Users/zhuzhiheng/.appwrite-cf/prefs.json','utf8'));const cookie=prefs[prefs.current].cookie;
const projectId=`image-edit-archive-${Date.now()}`;
async function start(initialize:boolean){const api=createCanvasServer({dataRoot:path.resolve(`.tmp/image-edit-archive/${projectId}-${initialize}`),developmentActor:{teamId:'local',userId:'maintenance'},appwrite:{endpoint:'https://frontend-cloud.corp.kuaishou.com/v1',projectId:'grworkspace',databaseId:'canvas_app_dev',bucketId:'canvas_assets_v2',sessionCookie:cookie,sessionMode:'admin',runtime:{collectionId:'app_runtime_state',namespace:projectId,singleWriter:true,...(initialize?{initialize:true}:{})}},media:{catalog:async()=>imageCatalog,config:async()=>({providers:{}}),generate:async()=>{throw Error('No inference allowed');}}});await api.ready;const server=api.app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));return{api,base:`http://127.0.0.1:${(server.address() as {port:number}).port}`,close:async()=>{await new Promise<void>(r=>server.close(()=>r()));await api.close();}};}
let runtime=await start(true);
async function json(url:string,init?:RequestInit){const res=await fetch(runtime.base+url,init),value=await res.json();if(!res.ok)throw Error(JSON.stringify(value));return value.data??value;}
const post=(value:unknown,key='read')=>({method:'POST',headers:{'content-type':'application/json','idempotency-key':key},body:JSON.stringify(value)});
try{
 await json('/api/apps/canvas/actions/canvas.create',post({input:{instanceId:projectId,name:'工程回执归档验收'}},'create'));
 const png=await sharp({create:{width:32,height:24,channels:3,background:'#3388aa'}}).png().toBuffer(),form=new FormData();form.append('files',new Blob([new Uint8Array(png)],{type:'image/png'}),'source.png');const uploaded=await json(`/api/projects/${projectId}/upload`,{method:'POST',body:form});
 let state=await json(`/api/apps/image/instances/${projectId}/state`);await json(`/api/apps/canvas/instances/${projectId}/operations`,post({operationId:'attach',baseRevision:state.revision,operations:[{type:'image.attach',nodeId:'source',source:{path:uploaded.files[0].name},x:0,y:0}]},'attach'));
 state=await json(`/api/apps/image/instances/${projectId}/state`);const basePath=state.cards.find((c:{nodeId:string})=>c.nodeId==='source').node.path;
 const requests=[];
 for(let index=0;index<3;index++){
  state=await json(`/api/apps/image/instances/${projectId}/state`);
  const document={version:2,basePath,layers:[{id:'l1',name:`design-${index}`,path:basePath,quad:[[0,0],[1,0],[1,1],[0,1]],opacity:1,blend:'normal',lighting:0,wrinkle:0,mask:[]}],surface:null};
  const input={input:{nodeId:'source',document,expectedEditRevision:index},expectedRevision:state.revision};requests.push(input);
  await json(`/api/apps/image/instances/${projectId}/actions/image.edit.save`,post(input,`edit-${index}`));
 }
 const beforeConflict=await json(`/api/apps/image/instances/${projectId}/state`);
 const stale=await fetch(runtime.base+`/api/apps/image/instances/${projectId}/actions/image.edit.save`,post({...requests[0],expectedRevision:beforeConflict.revision},'stale-edit'));
 if(stale.status!==409)throw Error('A stale document overwrote newer edits');
 const snapshot=await runtime.api.canvas.read(projectId);const live=Object.values(snapshot.state.workbenchImageReceipts as Record<string,{actionId:string}>).filter(r=>r.actionId==='image.edit.save').length;
 if(live!==1)throw Error('Automatic edits are filling the generation receipt budget');
 await runtime.close();runtime=await start(false);
 const receipt=await json(`/api/apps/image/instances/${projectId}/action-receipts/edit-0`);if(receipt.status!=='succeeded')throw Error('Archived receipt not restored');
 const replay=await json(`/api/apps/image/instances/${projectId}/actions/image.edit.save`,post(requests[0],'edit-0'));if(!replay.replayed)throw Error('Archived operation was applied again');
 const read=await json(`/api/apps/image/instances/${projectId}/actions/image.edit.read`,post({input:{nodeId:'source'}}));if(read.result.document.layers[0].name!=='design-2')throw Error('Old replay overwrote current engineering data');
 const report={projectId,realCloud:true,saves:3,liveEditReceipts:live,archivedReceiptRestored:true,archivedReplayNoWrite:true,latestDocumentRetained:true,staleEditRejected:true,inferenceCalls:0};await mkdir('docs/verification/image-mvp-api-20261022',{recursive:true});await writeFile('docs/verification/image-mvp-api-20261022/archive-cloud.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await runtime.close();}
