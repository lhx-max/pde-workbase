/** Real Appwrite + actual image HTTP service/host/queue/delivery. Synthetic inputs and
 * model fixture only; vectorization uses the real CPU worker. No paid inference or ACL changes. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';import path from 'node:path';import {createRequire} from 'node:module';import {parseArgs} from 'node:util';
import {createCanvasServer} from '../apps/server/src/server.js';import {createHttpMediaAdapter} from '../apps/server/src/http-adapters.js';
const require=createRequire(new URL('../apps/server/package.json',import.meta.url));const sharp=require('sharp') as typeof import('sharp').default;
const {createImageService}=await import('../apps/server/node_modules/@ks-designai/image-card-pack/dist/image-service.js');
const {values}=parseArgs({options:{prefs:{type:'string'},'cache-dir':{type:'string'},report:{type:'string'}}});
for(const key of ['prefs','cache-dir','report'] as const)if(!values[key]||!path.isAbsolute(values[key]!))throw Error(`Pass absolute --${key}`);
const prefs=JSON.parse(await readFile(values.prefs!,'utf8'));const session=/a_session_console=([^;,\s]+)/u.exec(prefs[prefs.current].cookie)?.[1];if(!session)throw Error('No maintenance session');
const id=`image-mvp-api-${Date.now()}`;let modelCalls=0;
const fixturePng=await sharp({create:{width:64,height:48,channels:3,background:'#e7ad42'}}).png().toBuffer();
const image=createImageService({authorize:async()=>async()=> 'fixture-no-user-billing',fetcher:async()=>{modelCalls++;return Response.json({images:[{data:`data:image/png;base64,${fixturePng.toString('base64')}`,mimeType:'image/png'}]});}});
image.listen(0,'127.0.0.1');await new Promise<void>(r=>image.once('listening',r));const imagePort=(image.address() as {port:number}).port;
async function start(index:number,teamId='local'){const api=createCanvasServer({dataRoot:path.join(values['cache-dir']!,`${id}-${index}`),developmentActor:{teamId,userId:'maintenance'},appwrite:{endpoint:'https://frontend-cloud.corp.kuaishou.com/v1',projectId:'grworkspace',databaseId:'canvas_app_dev',bucketId:'canvas_assets_v2',sessionCookie:`a_session_console=${session}`,sessionMode:'admin',runtime:{collectionId:'app_runtime_state',namespace:id,singleWriter:true,...(index===0?{initialize:true}:{})}},media:createHttpMediaAdapter(`http://127.0.0.1:${imagePort}`)});await api.ready;const listener=api.app.listen(0,'127.0.0.1');await new Promise<void>(r=>listener.once('listening',r));return{api,base:`http://127.0.0.1:${(listener.address() as {port:number}).port}`,async close(){await new Promise<void>(r=>listener.close(()=>r()));await api.close();}};}
let runtime=await start(0);const artifacts:Array<{path:string;mime:string;width?:number;height?:number;bytes:number}>=[];
async function json(url:string,init?:RequestInit){const res=await fetch(runtime.base+url,init);const value=await res.json();if(!res.ok)throw Error(JSON.stringify(value));return value.data??value;}
const post=(value:unknown,key?:string)=>({method:'POST',headers:{'content-type':'application/json',...(key?{'idempotency-key':key}:{})},body:JSON.stringify(value)});
try{
 await json('/api/apps/canvas/actions/canvas.create',post({input:{instanceId:id,name:'图片工具完整接线验收'}},'create-proof'));
 const capabilities=await json(`/api/apps/image/instances/${id}/tools`);
 if(!capabilities.tools.find((t:{id:string;configured:boolean})=>t.id==='vectorize'&&t.configured)||capabilities.tools.find((t:{id:string;configured:boolean})=>t.id==='upscale')?.configured)throw Error('Discovery availability incorrect');
 const png=await sharp({create:{width:80,height:60,channels:3,background:'#228855'}}).composite([{input:await sharp({create:{width:30,height:30,channels:3,background:'#f95'}}).png().toBuffer(),left:10,top:10}]).png().toBuffer();
 const form=new FormData();form.append('files',new Blob([new Uint8Array(png)],{type:'image/png'}),'source.png');const mask=await sharp({create:{width:80,height:60,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();form.append('files',new Blob([new Uint8Array(mask)],{type:'image/png'}),'mask.png');const upload=await json(`/api/projects/${id}/upload`,{method:'POST',body:form});
 const before=await json(`/api/apps/canvas/instances/${id}/state`);const sourcePath=upload.files[0].name;
 await json(`/api/apps/canvas/instances/${id}/operations`,post({operationId:'attach-source',baseRevision:before.revision,operations:[{type:'image.attach',nodeId:'source',source:{path:sourcePath},x:0,y:0}]}));
 const attached=await json(`/api/apps/image/instances/${id}/state`);const originalPath=attached.cards.find((v:{nodeId:string})=>v.nodeId==='source')?.node.path;if(typeof originalPath!=='string')throw Error('Source did not attach');
 const receipts:Array<{kind:string;key:string;taskId:string;outputs:number}>=[];
 for(const [kind,params,key] of [['crop',{x:10,y:10,width:40,height:30},'crop-once'],['adjust',{exposure:30,grain:10},'adjust-once'],['transform',{rotation:90,flipX:true},'transform-once'],['relight',{azimuth:-45,elevation:25,brightness:50,color:'#ffffff',rim:false,smart:false},'relight-once'],['multi-angle',{mode:'camera',rotation:45,tilt:10,zoom:50},'angle-once'],['precision-edit',{point:{x:.4,y:.5},instruction:'改变该位置颜色'},'precision-once'],['expand',{targetCanvas:{width:100,height:80},sourcePlacement:{x:10,y:10,width:80,height:60}},'expand-once'],['erase',{mask:upload.files[1].name},'erase-once'],['mockup-fuse',{composite:sourcePath,mask:sourcePath,designs:[sourcePath]},'mockup-once'],['vectorize',{},'vector-once'],['reflow',{targets:[{width:256,height:256},{width:320,height:256}]},'reflow-once']] as const){
  const state=await json(`/api/apps/image/instances/${id}/state`);const request={input:{nodeId:'source',kind,params},expectedRevision:state.revision};
  const receipt=await json(`/api/apps/image/instances/${id}/actions/image.tool`,post(request,key));const taskId=receipt.result.taskIds[0];const task=await runtime.api.media.wait(taskId,AbortSignal.timeout(90000));if(task?.status!=='done')throw Error(JSON.stringify(task));await runtime.api.media.delivery.reconcile();
  const replay=await json(`/api/apps/image/instances/${id}/actions/image.tool`,post(request,key));if(!replay.replayed||replay.status!=='succeeded')throw Error('Receipt replay failed');
  const current=await runtime.api.canvas.read(id);const images=current.state.workbenchImages as Array<{id:string;path?:string;taskId?:string;mediaToolTaskId?:string}>;
  if(images.find(v=>v.id==='source')?.path!==originalPath)throw Error('Original source changed');
  const file=task.file as {name:string;outputs?:Array<{path:string;mime:string}>};const paths=file.outputs?.map(v=>v.path)??[file.name];if(paths.length!==(kind==='reflow'?2:1))throw Error('Tool artifacts were dropped');
  for(const filePath of paths){const response=await fetch(`${runtime.base}/api/projects/${id}/files/${filePath}`);if(!response.ok)throw Error('Cloud artifact not readable');const bytes=Buffer.from(await response.arrayBuffer());const meta=await sharp(bytes).metadata();if(!images.some(v=>v.path===filePath))throw Error('Result not mounted on canvas');if(kind==='vectorize'&&(!filePath.endsWith('.svg')||!bytes.toString().includes('<path')))throw Error('No actual SVG paths');artifacts.push({path:filePath,mime:response.headers.get('content-type')??'',width:meta.width,height:meta.height,bytes:bytes.length});}
  receipts.push({kind,key,taskId,outputs:paths.length});console.log(JSON.stringify({checked:kind,outputs:paths.length}));
 }
 if(modelCalls!==8)throw Error(`Unexpected model dispatches ${modelCalls}`);
 const adapter=runtime.api.media.adapter!,originalGenerate=adapter.generate;
 const jsonDocument={schemaVersion:'image-tool-edit-state/v1',layers:[{id:'ocr',text:'MVP可编辑文字',frame:{x:1,y:2,width:10,height:5},zIndex:1}]};
 adapter.generate=async input=>({path:String(input.request.output),mime:'image/png',content:fixturePng,toolResult:{kind:'layering',artifacts:[{mime:'image/png',content:fixturePng,width:64,height:48,role:'layer'},{mime:'application/json',content:Buffer.from(JSON.stringify(jsonDocument)),role:'edit-state'}]}});
 const jsonState=await json(`/api/apps/image/instances/${id}/state`);
 const jsonReceipt=await json(`/api/apps/image/instances/${id}/actions/image.tool`,post({input:{nodeId:'source',kind:'layering',params:{maxLayers:2}},expectedRevision:jsonState.revision},'json-once'));
 const jsonTask=await runtime.api.media.wait(jsonReceipt.result.taskIds[0],AbortSignal.timeout(90000));if(jsonTask?.status!=='done')throw Error(JSON.stringify(jsonTask));await runtime.api.media.delivery.reconcile();
 const jsonPath=(jsonTask.file as {outputs:Array<{path:string;mime:string}>}).outputs.find(v=>v.mime==='application/json')!.path;
 const jsonRead=await json(`/api/apps/image/instances/${id}/artifacts?path=${encodeURIComponent(jsonPath)}`);
 if(JSON.stringify(jsonRead.document)!==JSON.stringify(jsonDocument))throw Error('Public JSON artifact readback failed');
 adapter.generate=originalGenerate;
 const document={version:2,basePath:originalPath,layers:[{id:'design-one',name:'MVP design',path:originalPath,quad:[[.1,.1],[.9,.1],[.9,.9],[.1,.9]],opacity:.8,blend:'multiply',lighting:.25,wrinkle:0,mask:[],material:'paper'}],surface:null};
 const editState=await json(`/api/apps/image/instances/${id}/state`);
 const editRequest={input:{nodeId:'source',document,expectedEditRevision:0},expectedRevision:editState.revision};
 const editReceipt=await json(`/api/apps/image/instances/${id}/actions/image.edit.save`,post(editRequest,'edit-once'));
 if(editReceipt.status!=='succeeded')throw Error('Edit save failed');
 const editReplay=await json(`/api/apps/image/instances/${id}/actions/image.edit.save`,post(editRequest,'edit-once'));
 if(!editReplay.replayed)throw Error('Edit replay failed');
 const edited=await json(`/api/apps/image/instances/${id}/actions/image.edit.read`,post({input:{nodeId:'source'}}));
 if(JSON.stringify(edited.result.document)!==JSON.stringify(document))throw Error('Edit document lost');
 const denied=await fetch(runtime.base+`/api/apps/image/instances/${id}/actions/image.edit.read`,{...post({input:{nodeId:'source'}}),headers:{'content-type':'application/json','x-team-id':'foreign'}});
 if(denied.status!==200)throw Error('Untrusted header overrode fixed development identity');
 const currentEdit=await json(`/api/apps/image/instances/${id}/state`);
 const invalid=await fetch(runtime.base+`/api/apps/image/instances/${id}/actions/image.edit.save`,post({input:{nodeId:'source',expectedEditRevision:1,document:{...document,basePath:'inputs/foreign.png'}},expectedRevision:currentEdit.revision},'edit-invalid'));
 if(invalid.status!==409)throw Error('Source mismatch not denied');
 const count=((await runtime.api.canvas.read(id)).state.workbenchImages as unknown[]|undefined)?.length;await runtime.close();runtime=await start(2,'foreign');
 const foreign=await fetch(runtime.base+`/api/apps/image/instances/${id}/actions/image.edit.read`,post({input:{nodeId:'source'}}));if(foreign.status!==403)throw Error('Trusted foreign actor was not denied');
 await runtime.close();runtime=await start(1);await runtime.api.media.delivery.reconcile();
 const restoredJson=await json(`/api/apps/image/instances/${id}/artifacts?path=${encodeURIComponent(jsonPath)}`);if(JSON.stringify(restoredJson.document)!==JSON.stringify(jsonDocument))throw Error('JSON artifact restart readback failed');
 const restoredEdit=await json(`/api/apps/image/instances/${id}/actions/image.edit.read`,post({input:{nodeId:'source'}}));if(JSON.stringify(restoredEdit.result.document)!==JSON.stringify(document))throw Error('Editable document restart recovery failed');
 for(const receipt of receipts){const restored=await json(`/api/apps/image/instances/${id}/action-receipts/${receipt.key}`);if(restored.status!=='succeeded'||restored.result.taskIds[0]!==receipt.taskId)throw Error('Cloud receipt recovery failed');}
 if(((await runtime.api.canvas.read(id)).state.workbenchImages as unknown[]|undefined)?.length!==count||modelCalls!==8)throw Error('Restart duplicated results or generation');
 const report={verifiedAt:new Date().toISOString(),projectId:id,model:'HTTP fixture, no real billing',vectorization:'actual VTracer CPU worker',storage:'actual Appwrite',artifacts,receipts,modelCalls,jsonArtifactRestored:true,editableDocumentRestored:true,editReplay:true,foreignEditDeniedByExplicitDevelopmentActor:true,untrustedHeaderCannotOverrideActor:true,sourceMismatchDenied:true,originalRetained:true,replayNoExtraGeneration:true,freshCacheRestored:true,canvasImageCount:count,notClaimed:['real external GPU/OCR/layering/mockup providers','production MA authorization/billing/staging','production bucket privacy']};await mkdir(path.dirname(values.report!),{recursive:true});await writeFile(values.report!,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await runtime.close();await new Promise<void>(r=>image.close(()=>r()));}
