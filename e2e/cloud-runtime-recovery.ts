/** Real Appwrite recovery acceptance; MA/model/mirror transports are isolated fixtures. */
import {createServer,type Server} from 'node:http';
import {mkdtemp,readFile,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import assert from 'node:assert/strict';
import {AppwriteJsonState} from '../packages/app-cloud-state/src/index.js';
import {AppwriteClient} from '../apps/server/src/storage/appwrite-client.js';
import {canvasProviderProjectId} from '../apps/server/src/routes/canvas-provider.js';
import {createCanvasServer,type CanvasServer} from '../apps/server/src/server.js';
import {BindingStore} from '../apps/server/src/storage/bindings.js';
import {AppEntitlementStore} from '../apps/server/src/storage/app-entitlements.js';
import {AuditLog} from '../apps/server/src/storage/audit-log.js';
import {DocumentSyncJournal} from '../apps/server/src/storage/document-sync-journal.js';
import {CardRegistryStore} from '../apps/server/src/storage/card-registry.js';
import {CloudImageFiles} from '../apps/server/src/storage/cloud-image-files.js';
import {CloudProjectFiles} from '../apps/server/src/storage/cloud-project-files.js';
import {snapshotMediaJournal} from '../apps/server/src/media/cloud-task-journal.js';
import {insertMediaTask} from '../apps/server/src/media/tasks.js';
import {acceptMediaRequest} from '../apps/server/src/media/request-identity.js';
import type {MediaAdapter} from '../apps/server/src/media/adapter-service.js';
const {values}=parseArgs({options:{prefs:{type:'string'},'doc-repo':{type:'string'},output:{type:'string'}}});
for(const key of ['prefs','doc-repo','output'] as const)if(!values[key]||!path.isAbsolute(values[key]!))throw Error(`Absolute ${key} required`);
const prefs=JSON.parse(await readFile(values.prefs!,'utf8'));const config={endpoint:'https://frontend-cloud.corp.kuaishou.com/v1',projectId:'grworkspace',sessionCookie:prefs[prefs.current].cookie,sessionMode:'admin' as const};
const client=new AppwriteClient(config);const stamp=String(Date.now()),team=`recovery-${stamp}`,projectId=`cr-${stamp}`;
const ownedCanvasIds=new Set([projectId]);
const namespaces={canvas:`canvas-recovery-${stamp}`,doc:`doc-recovery-${stamp}`};
const checks:Array<{name:string;passed:boolean}>=[],cleanup:Array<{target:string;deleted:boolean}>=[];
const check=(name:string,ok:boolean)=>{assert.ok(ok,name);checks.push({name,passed:true});};
const servers=new Set<Server>(),canvases=new Set<CanvasServer>(),queues=new Set<{close():Promise<void>}>(),roots:string[]=[],docIds=new Set<string>(),newFiles=new Set<string>();
const listen=(s:Server)=>new Promise<string>((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',()=>{servers.add(s);resolve(`http://127.0.0.1:${(s.address() as {port:number}).port}`);});});
const stop=async(s:Server)=>{if(!servers.delete(s))return;await new Promise<void>(resolve=>{s.close(()=>resolve());s.closeAllConnections();});};
const headers=(user='writer')=>({'content-type':'application/json','x-mav-sso-authorization':`Bearer recovery-${user}`,'x-mav-tenant':user==='foreign'?team+'-foreign':team,'x-mav-application-instance-id':'recovery-instance'});
const ma=await listen(createServer((req,res)=>{
 const user=String(req.headers.authorization??'').replace('Bearer recovery-','');res.setHeader('content-type','application/json');
 if(!['writer','reader','foreign'].includes(user)||req.headers['x-mav-tenant']!==(user==='foreign'?team+'-foreign':team)){res.writeHead(403);res.end('{}');return;}
 const data=req.url?.endsWith('/me')?{userId:user,status:'active'}:{applicationInstanceId:'recovery-instance',applicationId:'canvas',providerInstanceId:'recovery-provider',bizId:'recovery-biz',status:'active'};
 res.end(JSON.stringify({data}));
}));
const authority={transport:{origin:ma}};
const request=async(base:string,route:string,method='GET',body?:unknown,user='writer')=>{
 const response=await fetch(base+route,{method,headers:headers(user),...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await response.text();
 let data:any;try{data=text?JSON.parse(text):{};}catch{data=text;}return{status:response.status,body:data};
};
const state=(app:'canvas'|'doc',initialize=false,override=client)=>new AppwriteJsonState({client:override,databaseId:app==='canvas'?'canvas_app_dev':'doc_app_dev',collectionId:'app_runtime_state',namespace:namespaces[app],singleWriter:true,initialize});
let calls=0;const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
const media:MediaAdapter={catalog:async()=>({providers:[{id:'fixture',integrated:true}],image:[{id:'recovery-model',label:'Offline recovery fixture',provider:'fixture',caps:['t2i']}],video:[],audio:{},aspects:['1:1'],videoLengthsSec:[],audioDurationsSec:[]}),config:async()=>({providers:{}}),generate:async input=>{calls++;return{path:String(input.request.output),content:png,mime:'image/png'};}};
const boot=async(port:AppwriteJsonState)=>{
 const root=await mkdtemp(path.join(tmpdir(),'cloud-recovery-'));roots.push(root);
 const api=createCanvasServer({dataRoot:root,runtimeState:port,appwrite:{...config,databaseId:'canvas_app_dev',bucketId:'canvas_assets_v2'},authority,authorizeAction:actor=>actor.userId==='writer',authorizeAppManagement:req=>req.get('x-mav-sso-authorization')==='Bearer recovery-writer',media});canvases.add(api);await api.ready;
 const http=createServer(api.app);return{api,http,base:await listen(http),root};
};
let failure:string|undefined;const pngId=`img-${createHash('sha256').update(png).digest('hex').slice(0,30)}`;
const pngExisted=Boolean(await client.getOrNull(`/storage/buckets/canvas_assets_v2/files/${pngId}`));
try{
 const port=state('canvas',true);await port.ready;
 const policies=new AppEntitlementStore('/unused',port);policies.put({scope:`team:${team}`,appId:'doc',effect:'deny',updatedBy:'writer'});await port.flush();
 await new CardRegistryStore(client,'canvas_app_dev').upsertGrant({scope:`team:${team}`,allowedKinds:['text','image'],source:'local'});
 const first=await boot(port);
 check('Canvas cloud create is acknowledged only after runtime durability',(await request(first.base,'/api/apps/canvas/actions/canvas.create','POST',{input:{instanceId:projectId,name:'Cloud recovery probe'}})).status===201);
 const httpFile='uploads/http-recovery.txt',httpText=`http-${stamp}`;
 const httpCreate=await request(first.base,`/api/projects/${projectId}/files`,'POST',{name:httpFile,content:httpText});
 check('Cloud general file creates through real authenticated HTTP',httpCreate.status===200&&typeof httpCreate.body.revision==='string');
 const emptyCreate=await request(first.base,`/api/projects/${projectId}/files`,'POST',{name:'empty.txt',content:''});
 check('Cloud HTTP persists a legitimate empty file',emptyCreate.status===200);
 const htmlCreate=await request(first.base,`/api/projects/${projectId}/files`,'POST',{name:'preview.html',content:'<!doctype html><title>Recovery</title><h1>Cloud HTML</h1>'});
 check('Cloud HTTP saves HTML for sandboxed preview',htmlCreate.status===200);
 const manualVersion=await request(first.base,`/api/projects/${projectId}/files/preview.html/versions`,'POST',{label:'Recovery checkpoint',prompt:'Cloud version metadata',source:'manual'});
 check('Cloud HTTP creates an actual labeled HTML checkpoint',manualVersion.status===200&&manualVersion.body.version?.label==='Recovery checkpoint');
 check('Read-only caller cannot create a manual version',(await request(first.base,`/api/projects/${projectId}/files/preview.html/versions`,'POST',{label:'denied'},'reader')).status===403);
 const folderCreate=await request(first.base,`/api/projects/${projectId}/folders`,'POST',{name:'empty-folder'});
 check('Cloud HTTP persists an empty logical folder',folderCreate.status===200);
 const artifactName='outputs/published.html';
 const publishedArtifact=await request(first.base,'/api/projects/'+projectId+'/files','POST',{name:artifactName,content:'<!doctype html><title>Published</title><h1>Complete artifact</h1>',artifact:true});
 check('Cloud HTTP publishes guarded artifact bytes with durable typed metadata',publishedArtifact.status===200&&publishedArtifact.body.file?.artifactKind==='html'&&publishedArtifact.body.file.artifactManifest?.entry===artifactName);
 const blockedArtifact=await request(first.base,'/api/projects/'+projectId+'/files','POST',{name:'outputs/blocked.html',content:'<!doctype html><h1>Name to confirm</h1>',artifact:true});
 check('Cloud artifact publication guard rejects placeholders before saving bytes',blockedArtifact.status===400&&(await request(first.base,'/api/projects/'+projectId+'/raw/outputs/blocked.html')).status===404);
 const invalidArtifactRename=await request(first.base,'/api/projects/'+projectId+'/files/rename','POST',{from:artifactName,to:'outputs/wrong.txt',expectedRevision:publishedArtifact.body.revision});
 check('Artifact rename validates renderer extension before moving its canonical head',invalidArtifactRename.status===400&&(await request(first.base,'/api/projects/'+projectId+'/raw/'+artifactName)).status===200);
 const providerId='recovery-provider',providerProject=canvasProviderProjectId(team,'canvas',providerId);ownedCanvasIds.add(providerProject);
 const providerAction=(base:string,actionId:string,input:unknown={},expectedRevision?:number,key=actionId+'-'+stamp)=>request(base,'/open-platform/v1/instances/'+providerId+'/actions/'+actionId,'POST',{protocolVersion:'1.0',requestId:key,idempotencyKey:key,applicationId:'canvas',applicationVersion:'1.0',applicationInstanceId:'recovery-instance',providerInstanceId:providerId,bizId:'recovery-biz',sessionId:'recovery-session',actor:{tenantId:team,userId:'writer'},actionId,input,...(expectedRevision===undefined?{}:{expectedRevision})});
 const providerCreated=await providerAction(first.base,'canvas.create',{name:'Real cloud provider probe'});
 check('Authenticated Provider creates a real Appwrite-compatible canvas ID after metadata flush',providerCreated.status===200&&providerCreated.body.data?.canvasInstanceId===providerProject&&providerProject.length===35);
 const providerMutation={operations:[{type:'node.create',node:{id:'provider-cloud-text',kind:'text',x:0,y:0,text:'Provider cloud content'}}]};
 const providerSaved=await providerAction(first.base,'canvas.operations',providerMutation,providerCreated.body.revision,'provider-operation-'+stamp);
 check('Provider operations commit through the real Appwrite canvas journal',providerSaved.status===200&&Number.isSafeInteger(providerSaved.body.revision)&&providerSaved.body.revision>providerCreated.body.revision);
 const cloudFiles=new CloudProjectFiles(client,'canvas_app_dev','canvas_assets_v2',port);
 const binaryPath=`uploads/recovery-${stamp}.bin`,binaryA=Buffer.from(`original-${stamp}`),binaryB=Buffer.from(`updated-${stamp}`);
 await cloudFiles.write(projectId,binaryPath,binaryA,'application/octet-stream',{createOnly:true});
 const firstBinary=(await cloudFiles.read(projectId,binaryPath))!;
 check('General binary file is stored and verified in real cloud bytes',firstBinary.buffer.equals(binaryA));
 await assert.rejects(cloudFiles.write(projectId,binaryPath,binaryB,'application/octet-stream'),{status:428});
 await assert.rejects(cloudFiles.write(projectId,binaryPath,binaryB,'application/octet-stream',{expectedRevision:'stale'}),{status:409});
 check('General cloud files reject missing and stale overwrite baselines',true);
 await cloudFiles.write(projectId,binaryPath,binaryB,'application/octet-stream',{expectedRevision:firstBinary.revision});
 const originalBinaryVersion=(await cloudFiles.versions(projectId,binaryPath)).find(version=>version.sha256===firstBinary.revision)!;
 const changed=await request(first.base,`/api/apps/canvas/instances/${projectId}/operations`,'POST',{operationId:'seed-recovery',baseRevision:0,operations:[{type:'node.create',node:{id:'recovery-text',kind:'text',x:0,y:0,text:'Pending cloud intent'}}]});
 check('Canvas text change commits a recoverable synchronization intent',changed.status===200);
 new BindingStore('/unused',port).upsert({canvasInstanceId:projectId,nodeId:'recovery-text',appId:'doc',appInstanceId:'fixture-document',teamId:team,mirrorPath:'recovery.md'});
 new AuditLog('/unused',port).record({actor:{teamId:team,userId:'writer'},action:'recovery.probe',appId:'canvas',targetId:projectId,status:'succeeded'});
 first.api.ledger.record({projectId,type:'recovery.probe',source:'acceptance',entityType:'canvas',entityId:projectId,summary:'Recovery fixture',idempotencyKey:'recovery-ledger',payload:{accessToken:'must-be-redacted'}});await port.flush();
 const asset=await request(first.base,'/api/asset-library','POST',{kind:'text',name:'Recoverable library asset',content:`library-${stamp}`});const assetId=asset.body.asset?.id;
 check('Cloud asset library creates through the real authenticated HTTP surface',asset.status===201&&Boolean(assetId));
 check('Cloud asset library denies a verified reader write',(await request(first.base,'/api/asset-library','POST',{kind:'text',name:'Denied'},'reader')).status===403);
 const imageReceiptKey='cloud-image-receipt-'+stamp;
 const imageWorkspace=await first.api.canvas.read(projectId);
 const imageCreateResponse=await fetch(first.base+`/api/apps/image/actions/image.create`,{method:'POST',headers:{...headers(),'idempotency-key':imageReceiptKey},body:JSON.stringify({input:{canvasId:projectId,nodeId:'recovery-image-source',x:0,y:0,config:{prompt:'No generation'}},expectedRevision:imageWorkspace.revision})});
 const imageCreated=await imageCreateResponse.json() as any;
 check('Image App creates a caller-bound receipt in real cloud canvas state',imageCreateResponse.status===200&&typeof imageCreated.data?.receiptId==='string');
 const imageReceiptId=imageCreated.data.receiptId;
 const mediaRequest={surface:'image',model:'recovery-model',prompt:'offline fixture',output:`outputs/recovery-${stamp}.png`,clientRequestId:randomUUID()};
 const submitted=await request(first.base,`/api/projects/${projectId}/media/generate`,'POST',mediaRequest);const taskId=submitted.body.taskId;
 check('Accepted model fixture task receives a durable task identifier',submitted.status===202&&Boolean(taskId));
 await first.api.media.wait(taskId,AbortSignal.timeout(30000));await port.flush();
 check('Model fixture executes exactly once',calls===1&&first.api.media.get(taskId)?.status==='done');
 const pendingRequest={...mediaRequest,clientRequestId:randomUUID(),output:`outputs/pending-${stamp}.png`};const pendingId=randomUUID();
 acceptMediaRequest(first.api.db,projectId,pendingRequest,()=>{const task=insertMediaTask(first.api.db,{id:pendingId,projectId,surface:'image',model:'recovery-model',status:'running'});first.api.db.prepare('INSERT INTO media_adapter_requests(task_id,request_json) VALUES (?,?)').run(task.id,JSON.stringify(pendingRequest));return task;});
 port.write('media-tasks',snapshotMediaJournal(first.api.db));await port.flush();
 await stop(first.http);await first.api.close();canvases.delete(first.api);await rm(first.root,{recursive:true,force:true});
 const secondPort=state('canvas');const second=await boot(secondPort);
 const httpRecovered=await fetch(`${second.base}/api/projects/${projectId}/raw/${httpFile}`,{headers:headers()});
 check('Cloud HTTP raw bytes and baseline survive empty-root restart',httpRecovered.status===200&&await httpRecovered.text()===httpText&&httpRecovered.headers.get('x-content-revision')===httpCreate.body.revision);
 const httpRange=await fetch(`${second.base}/api/projects/${projectId}/raw/${httpFile}`,{headers:{...headers(),range:'bytes=0-3'}});
 check('Cloud HTTP serves an actual verified byte range',httpRange.status===206&&await httpRange.text()===httpText.slice(0,4));
 check('Cloud HTTP refuses a reader write',(await request(second.base,`/api/projects/${projectId}/files`,'POST',{name:httpFile,content:'denied',expectedRevision:httpCreate.body.revision},'reader')).status===403);
 check('Cloud HTTP refuses a foreign tenant raw read',(await request(second.base,`/api/projects/${projectId}/raw/${httpFile}`,'GET',undefined,'foreign')).status===403);
 const emptyRead=await fetch(`${second.base}/api/projects/${projectId}/raw/empty.txt`,{headers:headers()});
 check('Empty cloud HTTP file remains readable after restart',emptyRead.status===200&&(await emptyRead.arrayBuffer()).byteLength===0);
 const folders=await request(second.base,`/api/projects/${projectId}/folders`);
 check('Cloud logical folder recovers through HTTP',folders.status===200&&JSON.stringify(folders.body).includes('empty-folder'));
 const search=await request(second.base,`/api/projects/${projectId}/search?q=${encodeURIComponent(httpText)}`);
 check('Cloud HTTP search reads authoritative recovered bytes',search.status===200&&search.body.matches?.some((match:any)=>match.file===httpFile));
 const recoveredVersions=await request(second.base,`/api/projects/${projectId}/files/preview.html/versions`);
 check('Labeled checkpoint and prompt survive empty-root cloud reconstruction',recoveredVersions.status===200&&recoveredVersions.body.versions?.some((v:any)=>v.id===manualVersion.body.version.id&&v.label==='Recovery checkpoint'&&v.prompt==='Cloud version metadata'));
 const checkpointBytes=await fetch(`${second.base}/api/projects/${projectId}/files/preview.html/versions/${manualVersion.body.version.id}`,{headers:headers()});
 check('Recovered manual checkpoint serves the exact immutable HTML bytes',checkpointBytes.status===200&&await checkpointBytes.text()==='<!doctype html><title>Recovery</title><h1>Cloud HTML</h1>');
 const preview=await request(second.base,`/api/projects/${projectId}/preview-url?file=preview.html`);
 check('Cloud HTTP returns an opaque sandboxed HTML preview URL',preview.status===200&&preview.body.opaqueOrigin===true&&!preview.body.iframeSandbox.includes('allow-same-origin'));
 const htmlPreview=await fetch(second.base+preview.body.url,{headers:headers()});
 check('Opaque HTML preview serves cloud content under restrictive CSP',htmlPreview.status===200&&(await htmlPreview.text()).includes('Cloud HTML')&&Boolean(htmlPreview.headers.get('content-security-policy')?.includes('sandbox')));
 const zip=await fetch(`${second.base}/api/projects/${projectId}/archive`,{headers:headers()});const zipBytes=Buffer.from(await zip.arrayBuffer());
 check('Cloud HTTP creates a real ZIP from authoritative files',zip.status===200&&zipBytes.subarray(0,2).toString()==='PK');
 const providerRead=await providerAction(second.base,'canvas.read');
 check('Provider resolves the same canonical canvas after empty-root restart',providerRead.status===200&&providerRead.body.data?.canvasInstanceId===providerProject&&providerRead.body.revision===providerSaved.body.revision&&JSON.stringify(providerRead.body.data.state).includes('Provider cloud content'));
 const providerReplay=await providerAction(second.base,'canvas.operations',providerMutation,providerCreated.body.revision,'provider-operation-'+stamp);
 check('Provider replays the original cloud receipt before current revision checks',providerReplay.status===200&&providerReplay.body.revision===providerSaved.body.revision&&providerReplay.body.data.receipt.operationId===providerSaved.body.data.receipt.operationId);
 const publishedListing=await request(second.base,'/api/projects/'+projectId+'/files');
 check('Artifact title and renderer metadata survive empty-root reconstruction',publishedListing.status===200&&publishedListing.body.files?.some((file:any)=>file.name===artifactName&&file.artifactKind==='html'&&file.artifactManifest?.entry===artifactName));
 const renamedArtifact=await request(second.base,'/api/projects/'+projectId+'/files/rename','POST',{from:artifactName,to:'outputs/renamed.html',expectedRevision:publishedArtifact.body.revision});
 check('Cloud artifact rename preserves the matching manifest and its exact new entry',renamedArtifact.status===200&&renamedArtifact.body.file?.artifactKind==='html'&&renamedArtifact.body.file.artifactManifest?.entry==='outputs/renamed.html');
 const reopenedFiles=new CloudProjectFiles(client,'canvas_app_dev','canvas_assets_v2',secondPort);
 const recoveredBinary=(await reopenedFiles.read(projectId,binaryPath))!;
 check('General binary file survives deletion of the old working directory',recoveredBinary.buffer.equals(binaryB));
 check('Immutable original file version survives restart',(await reopenedFiles.readVersion(projectId,binaryPath,originalBinaryVersion.id)).buffer.equals(binaryA));
 const renamedPath=`uploads/renamed-${stamp}.bin`;
 await reopenedFiles.rename(projectId,binaryPath,renamedPath,{expectedRevision:recoveredBinary.revision});
 check('Cloud file rename changes the canonical path without losing bytes',await reopenedFiles.read(projectId,binaryPath)===null&&(await reopenedFiles.read(projectId,renamedPath))!.buffer.equals(binaryB));
 await reopenedFiles.restore(projectId,renamedPath,originalBinaryVersion.id,{expectedRevision:recoveredBinary.revision});
 const restoredBinary=(await reopenedFiles.read(projectId,renamedPath))!;
 check('Cloud file restore returns verified old bytes',restoredBinary.buffer.equals(binaryA));
 await reopenedFiles.delete(projectId,renamedPath,{expectedRevision:restoredBinary.revision});
 check('Deleting a cloud file retains recoverable immutable history',await reopenedFiles.read(projectId,renamedPath)===null&&(await reopenedFiles.readVersion(projectId,renamedPath,originalBinaryVersion.id)).buffer.equals(binaryA));
 check('Fresh disposable directory restores the original cloud canvas',(await request(second.base,`/api/apps/canvas/instances/${projectId}/state`)).status===200);
 check('Card to App binding survives deletion of the old local root',new BindingStore('/unused',secondPort).getActive(projectId,'recovery-text','doc')?.appInstanceId==='fixture-document');
 check('Governance deny survives restart',new AppEntitlementStore('/unused',secondPort).resolve('doc',{teamId:team,userId:'writer'})==='deny');
 check('Pending or blocked sync intent survives restart',['pending','blocked'].includes(new DocumentSyncJournal('/unused',secondPort).get(projectId,'recovery-text')?.status??''));
 check('Audit records survive restart',new AuditLog('/unused',secondPort).list({teamId:team}).some(row=>row.action==='recovery.probe'));
 check('Project ledger survives restart without stored credential values',second.api.ledger.list(projectId).events.some(row=>row.type==='recovery.probe')&&!JSON.stringify(second.api.ledger.list(projectId)).includes('must-be-redacted'));
 const library=await request(second.base,`/api/asset-library/${assetId}`);check('Cloud library metadata survives restart',library.status===200&&library.body.asset?.name==='Recoverable library asset');
 const content=await fetch(second.base+`/api/asset-library/${assetId}/content`,{headers:headers()});check('Cloud library bytes survive restart',content.status===200&&await content.text()===`library-${stamp}`);
 check('Foreign tenant cannot read recovered library resource',(await request(second.base,`/api/asset-library/${assetId}`,'GET',undefined,'foreign')).status===404);
 check('Read-only user can read recovered canvas',(await request(second.base,`/api/apps/canvas/instances/${projectId}/state`,'GET',undefined,'reader')).status===200);
 check('Read-only user still cannot mutate recovered canvas',(await request(second.base,`/api/apps/canvas/instances/${projectId}/operations`,'POST',{operationId:'denied',baseRevision:1,operations:[]},'reader')).status===403);
 check('Completed media task survives an empty-root restart',second.api.media.get(taskId)?.status==='done');
 check('Seeded running journal is interrupted without automatic generation',second.api.media.get(pendingId)?.status==='interrupted'&&second.api.media.get(pendingId)?.error?.code==='DAEMON_RESTART'&&calls===1);
 const httpReplay=await request(second.base,`/api/projects/${projectId}/media/generate`,'POST',mediaRequest);
 check('Original MA caller media request reuses its durable task ID',httpReplay.status===202&&httpReplay.body.taskId===taskId&&calls===1);
 const imageReceipt=await request(second.base,`/api/apps/image/instances/${projectId}/action-receipts/${imageReceiptId}`);
 check('Image caller receipt survives fresh service and cloud reconstruction',imageReceipt.status===200&&imageReceipt.body.data?.receiptId===imageReceiptId);
 check('Another authorized project reader cannot query the creator receipt',(await request(second.base,`/api/apps/image/instances/${projectId}/action-receipts/${imageReceiptId}`,'GET',undefined,'reader')).status===404);
 check('Interrupted request replay does not dispatch another provider call',(await second.api.media.submit(projectId,pendingRequest)).taskId===pendingId&&calls===1);
 const image=await new CloudImageFiles(client,'canvas_app_dev','canvas_assets_v2').read(projectId,mediaRequest.output);check('Generated fixture output is recovered from cloud bytes',Boolean(image?.buffer.equals(png)));
 const docModule=async(name:string)=>import(pathToFileURL(path.join(values['doc-repo']!,'apps/server/src',name+'.ts')).href);
 const [{AppwriteClient:DocClient},{AppwriteDocStore},{createApp},{MirrorDeliveryQueue},{resolveTenant},{AppwriteDocImageStorage}]=await Promise.all(['appwrite-client','appwrite-store','app','mirror-delivery-queue','tenant','doc-image-storage'].map(docModule));
 class ProbeDocClient extends DocClient {async upload(bucket:string,id:string,name:string,bytes:Uint8Array,mime:string){const result=await super.upload(bucket,id,name,bytes,mime);newFiles.add(id);return result;}}
 const makeDocStore=()=>new AppwriteDocStore(new ProbeDocClient(config),'doc_app_dev','doc_assets_v2',{singleWriter:true});
 const images=()=>new AppwriteDocImageStorage({client:new ProbeDocClient(config),bucketId:'doc_assets_v2'});
 let docStore=makeDocStore();const docPort=state('doc',true);await docPort.ready;
 const docHttp=createServer(createApp(docStore,{state:docPort,images:images(),auth:{maAuthority:authority},authorizeWrite:(who:{userId:string})=>who.userId==='writer'}));let docBase=await listen(docHttp);
 const createBody={input:{name:`receipt-${stamp}`,content:`receipt-content-${stamp}`}},receiptKey=`receipt-${stamp}`;
 const created=await request(docBase,'/api/apps/doc/actions/doc.create','POST',createBody); // unique automatic durable receipt
 check('Document action with real Appwrite store succeeds',created.status===200);docIds.add(created.body.data.result.instanceId);
 const imageDocumentId=created.body.data.result.instanceId;
 const uploadedImage=await request(docBase,'/api/documents/'+imageDocumentId+'/images','POST',{name:'cloud-probe.png',base64:png.toString('base64')});
 check('Document uploads and verifies a real private-per-file PNG through HTTP',uploadedImage.status===200&&typeof uploadedImage.body.data?.fileId==='string');
 const imagePath=uploadedImage.body.data.path;
 check('Verified document reader cannot upload an image',(await request(docBase,'/api/documents/'+imageDocumentId+'/images','POST',{name:'denied.png',base64:png.toString('base64')},'reader')).status===403);
 check('Foreign tenant cannot read document attachment bytes',(await request(docBase,imagePath,'GET',undefined,'foreign')).status===403);

 const keyed=async(base:string,key:string,body:unknown)=>{const response=await fetch(base+'/api/apps/doc/actions/doc.create',{method:'POST',headers:{...headers(),'idempotency-key':key},body:JSON.stringify(body)});return{status:response.status,body:await response.json() as any};};
 const initial=await keyed(docBase,receiptKey,createBody);docIds.add(initial.body.data.result.instanceId);await stop(docHttp);
 const restartedDocState=state('doc');await restartedDocState.ready;docStore=makeDocStore();const recoveredDocHttp=createServer(createApp(docStore,{state:restartedDocState,images:images(),auth:{maAuthority:authority},authorizeWrite:()=>true}));docBase=await listen(recoveredDocHttp);
 const reopenedImage=await fetch(docBase+imagePath,{headers:headers()});check('Document attachment bytes survive a fresh App and cloud client',reopenedImage.status===200&&Buffer.from(await reopenedImage.arrayBuffer()).equals(png)&&reopenedImage.headers.get('cache-control')==='private, no-store');
 const replay=await keyed(docBase,receiptKey,createBody);check('Document receipt survives a new App and new cloud port',replay.status===200&&replay.body.data.replayed===true&&replay.body.data.result.instanceId===initial.body.data.result.instanceId);
 check('Document same key changed input conflicts after restart',(await keyed(docBase,receiptKey,{input:{name:'changed'}})).status===409);
 check('Foreign tenant cannot query recovered document receipt',(await request(docBase,`/api/apps/doc/action-receipts/${receiptKey}`,'GET',undefined,'foreign')).status===404);
 await stop(recoveredDocHttp);
 // Inject only completion-write failure over real storage: reservation and business create land, completion does not.
 const uncertainKey=`uncertain-${stamp}`;const flaky=Object.create(client) as AppwriteClient;
 flaky.call=async<T>(method:string,route:string,body?:unknown):Promise<T>=>{const data=(body as {data?:{slot?:string;payload?:string}})?.data;if(method==='PATCH'&&data?.slot==='doc-action-receipts'&&JSON.parse(data.payload!).records.some((row:any)=>row.receiptId===uncertainKey&&row.status==='succeeded'))throw Error('Injected completion outage');return client.call<T>(method,route,body);};
 const uncertainPort=state('doc',false,flaky);await uncertainPort.ready;const uncertainHttp=createServer(createApp(docStore,{state:uncertainPort,images:images(),auth:{maAuthority:authority},authorizeWrite:()=>true}));const uncertainBase=await listen(uncertainHttp);
 const uncertainBody={input:{name:`uncertain-document-${stamp}`,content:`uncertain-content-${stamp}`}};
 check('Completion storage failure is not reported as successful action',(await keyed(uncertainBase,uncertainKey,uncertainBody)).status===503);
 const after=await docStore.list(team);const uncertainDocs=after.filter((row:any)=>row.name===`uncertain-document-${stamp}`);for(const row of uncertainDocs)docIds.add(row.id);
 check('Crash-gap fixture really committed the document once',uncertainDocs.length===1);await stop(uncertainHttp);
 const finalDocPort=state('doc');await finalDocPort.ready;docStore=makeDocStore();const finalDocHttp=createServer(createApp(docStore,{state:finalDocPort,images:images(),auth:{maAuthority:authority},authorizeWrite:()=>true}));const finalDocBase=await listen(finalDocHttp);
 const uncertainReplay=await keyed(finalDocBase,uncertainKey,uncertainBody);check('Recovered pending reservation refuses duplicate mutation',uncertainReplay.status===503&&uncertainReplay.body.error.code==='DOC_OPERATION_UNCERTAIN'&&(await docStore.list(team)).filter((row:any)=>row.name===`uncertain-document-${stamp}`).length===1);
 // Real cloud outbox with an owned deterministic mirror transport, not a deployed canvas/MA claim.
 const beforeText=`before-${stamp}`,afterText=`after-${stamp}`;const bound=await docStore.create(`outbox-${stamp}`,{content:beforeText,nodeId:'outbox-node',mirrorCanvasId:'owned-mirror-fixture',mirrorPath:'outbox.md',teamId:team,bizId:'recovery-biz',createdBy:'writer',maApplicationId:'canvas',maApplicationInstanceId:'recovery-instance',maProviderInstanceId:'recovery-provider'});docIds.add(bound.id);
 const saved=await docStore.write(bound.id,afterText,{baseContent:beforeText});let online=false,deliveries=0;const forwarded:Array<string|null>=[];
 const mirrorFetch:typeof fetch=async(url,init)=>{if(!online)throw Error('Owned mirror fixture offline');forwarded.push(new Headers(init?.headers).get('x-mav-sso-authorization'));if(String(url).endsWith('/state'))return Response.json({data:{revision:3,state:{workbenchBasicNodes:[{id:'outbox-node',kind:'text',projectFilePath:'outbox.md'}]}}});if(String(url).endsWith('/bindings'))return Response.json({data:{}});deliveries++;return Response.json({data:{path:'outbox.md'}});};
 const liveActor=await resolveTenant(headers(),{maAuthority:authority});const outbox1=new MirrorDeliveryQueue({state:finalDocPort,store:docStore,canvasOrigin:'http://owned-mirror.invalid',fetchImpl:mirrorFetch});queues.add(outbox1);
 const pending=await outbox1.deliver({meta:saved,content:afterText,previousContent:beforeText,documentRevision:saved.revision,actor:liveActor});check('Unavailable mirror leaves a real durable outbox entry',pending.status==='unavailable');await outbox1.close();queues.delete(outbox1);await stop(finalDocHttp);
 const outboxState=state('doc');await outboxState.ready;const outbox2=new MirrorDeliveryQueue({state:outboxState,store:makeDocStore(),canvasOrigin:'http://owned-mirror.invalid',fetchImpl:mirrorFetch});queues.add(outbox2);
 check('Outbox content and baseline survive reconstruction',(await outbox2.get(bound.id))?.content===afterText&&(await outbox2.get(bound.id))?.baseContent===beforeText);
 online=true;await outbox2.retry(bound.id,{actor:await resolveTenant(headers(),{maAuthority:authority})});
 check('Explicit authorized retry delivers recovered outbox',(await outbox2.getStatus(bound.id))?.status==='synced'&&deliveries===1);
 check('Only live authority is forwarded and no credential is in cloud journal',forwarded.every(value=>value==='Bearer recovery-writer')&&!JSON.stringify(outboxState.read('doc-mirror-outbox')).includes('Bearer'));
}catch(error){failure=error instanceof Error?error.message:String(error);}
finally{
 for(const queue of queues){try{await queue.close();}catch{}}
 for(const http of [...servers])await stop(http);
 for(const api of canvases){try{await api.close();}catch{}}
 const remove=async(target:string,route:string)=>{try{await client.call('DELETE',route);cleanup.push({target,deleted:true});}catch{cleanup.push({target,deleted:false});}};
 for(const ownedId of ownedCanvasIds){
  for(const collection of ['canvas_operations','canvas_files']){
   const base=client.docsPath('canvas_app_dev',collection);const rows=await client.call<{documents:Array<{$id:string;canvasId:string}>}>('GET',base+'?'+AppwriteClient.query([AppwriteClient.eq('canvasId',ownedId),AppwriteClient.limit(100)]));
   for(const row of rows.documents){assert.equal(row.canvasId,ownedId);await remove(collection+':'+row.$id,base+'/'+row.$id);}
  }
  const canvasPath=client.docsPath('canvas_app_dev','canvases')+'/'+ownedId;if(await client.getOrNull(canvasPath))await remove('canvas:'+ownedId,canvasPath);
 }
 const grants=client.docsPath('canvas_app_dev','card_grants');const grantRows=await client.call<{documents:Array<{$id:string;scope:string}>}>('GET',`${grants}?${AppwriteClient.query([AppwriteClient.eq('scope','team:'+team),AppwriteClient.limit(100)])}`);for(const row of grantRows.documents){assert.equal(row.scope,'team:'+team);await remove('grant:'+row.$id,grants+'/'+row.$id);}
 for(const id of docIds)await remove('doc:'+id,client.docsPath('doc_app_dev','documents')+'/'+id);
 for(const id of newFiles)await remove('doc-file:'+id,'/storage/buckets/doc_assets_v2/files/'+id);
 for(const app of ['canvas','doc'] as const){
  const base=client.docsPath(app==='canvas'?'canvas_app_dev':'doc_app_dev','app_runtime_state');const rows=await client.call<{documents:Array<{$id:string;namespace:string;slot:string;payload:string}>}>('GET',`${base}?${AppwriteClient.query([AppwriteClient.eq('namespace',namespaces[app]),AppwriteClient.limit(100)])}`);
  for(const row of rows.documents){assert.equal(row.namespace,namespaces[app]);if(row.slot.startsWith('asset-library:'))for(const blob of JSON.parse(row.payload).blobs)await remove('library-file:'+blob.fileId,'/storage/buckets/canvas_assets_v2/files/'+blob.fileId);
   if(app==='canvas'&&row.slot.startsWith('file-versions:')){const history=JSON.parse(row.payload);assert(ownedCanvasIds.has(history.projectId));const ids=new Set<string>(Object.values(history.entries).flatMap((entry:any)=>entry.versions.map((version:any)=>version.fileId)).filter((id:any)=>typeof id==='string'&&id.startsWith('pfv-')) as string[]);for(const id of ids)await remove('project-file:'+id,'/storage/buckets/canvas_assets_v2/files/'+id);}
   await remove(app+'-runtime:'+row.slot,base+'/'+row.$id);}
 }
 if(!pngExisted&&await client.getOrNull('/storage/buckets/canvas_assets_v2/files/'+pngId)){
  const refs=await client.call<{documents:unknown[]}>('GET',client.docsPath('canvas_app_dev','canvas_files')+'?'+AppwriteClient.query([AppwriteClient.eq('fileId',pngId),AppwriteClient.limit(1)]));if(!refs.documents.length)await remove('generated-fixture-file','/storage/buckets/canvas_assets_v2/files/'+pngId);
 }
 for(const root of roots)await rm(root,{recursive:true,force:true});
 const report={verifiedAt:new Date().toISOString(),storage:'real Appwrite service-only runtime state + existing development business storage',identity:'isolated MA contract fixture',generation:'local PNG fixture; zero paid model calls',mirror:'owned deterministic transport fixture',passed:!failure&&cleanup.every(item=>item.deleted),checks,cleanup,...(failure?{failure}:{})};
 await mkdir(path.dirname(values.output!),{recursive:true});await writeFile(values.output!,JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
}
