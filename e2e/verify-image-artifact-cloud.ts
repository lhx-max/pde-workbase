/** Maintainer-only cloud artifact acceptance. Synthetic tool outputs, genuine Appwrite bytes/index/journal.
 * No inference, no ACL/schema changes, no assertions of production tenant isolation. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';import {parseArgs} from 'node:util';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {AppwriteClient} from '../apps/server/src/storage/appwrite-client.js';import {CloudImageFiles} from '../apps/server/src/storage/cloud-image-files.js';
import {CloudToolArtifactFiles} from '../apps/server/src/storage/cloud-tool-artifact-files.js';import {ImageToolCloudJournal} from '../apps/server/src/storage/image-tool-journal.js';
import {AppwriteJsonState} from '../packages/app-cloud-state/src/index.js';
const require=createRequire(new URL('../apps/server/package.json',import.meta.url));const sharp=require('sharp') as typeof import('../apps/server/node_modules/sharp/dist/index.mjs').default;
const {ToolArtifactStore}=await import(pathToFileURL(require.resolve('@ks-designai/image-card-pack/artifact-store')).href);
const {values}=parseArgs({options:{prefs:{type:'string'},report:{type:'string'}}});for(const key of ['prefs','report'] as const)if(!values[key]||!path.isAbsolute(values[key]!))throw Error(`Pass absolute --${key}`);
const prefs=JSON.parse(await readFile(values.prefs!,'utf8')),session=/a_session_console=([^;,\s]+)/u.exec(prefs[prefs.current].cookie)?.[1];if(!session)throw Error('No maintenance session');
const client=new AppwriteClient({endpoint:'https://frontend-cloud.corp.kuaishou.com/v1',projectId:'grworkspace',sessionCookie:`a_session_console=${session}`,sessionMode:'admin'});
const id=`image-artifacts-${Date.now()}`,scope={namespace:id,projectId:id},actorId='maintenance-proof';let writes=0;
const rawCall=client.call.bind(client);client.call=async(method,p,body,extra)=>{if(!['GET','HEAD'].includes(method))writes++;return rawCall(method,p,body,extra);};
const authorize=async(s:{namespace:string;projectId:string},_mode:'read'|'write')=>{if(s.namespace!==scope.namespace||s.projectId!==scope.projectId)throw Object.assign(Error('Scope denied'),{status:403});};
async function build(initialize:boolean){
 const state=new AppwriteJsonState({client,databaseId:'canvas_app_dev',collectionId:'app_runtime_state',namespace:id,singleWriter:true,...(initialize?{initialize:true}:{})});await state.ready;
 const images=new CloudImageFiles(client,'canvas_app_dev','canvas_assets_v2');const files=new CloudToolArtifactFiles({client,state,bucketId:'canvas_assets_v2',images,authorize});
 const journal=new ImageToolCloudJournal(state,authorize,{singleWriter:true});
 const store=new ToolArtifactStore({journal,files,authorize:async(s:{namespace:string;projectId:string},actor:string,mode:'read'|'write')=>{if(actor!==actorId)throw Object.assign(Error('Actor denied'),{status:403});await authorize(s,mode);}});
 return{state,files,images,store};
}
const created=await fetch('http://127.0.0.1:17462/api/apps/canvas/actions/canvas.create',{method:'POST',headers:{'content-type':'application/json','idempotency-key':id},body:JSON.stringify({input:{instanceId:id,name:'图片多类型资源持久化验收'}})});if(!created.ok)throw Error(`Canvas creation ${created.status}`);
const first=await build(true);
const png=await sharp({create:{width:64,height:48,channels:4,background:'#44aa77'}}).png().toBuffer();const layer=await sharp(png).resize(32,24).png().toBuffer();
const source=await first.images.write(id,'uploads/artifact-proof-source.png',png,'image/png');
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const sourceRef={path:source.name,sha256:sha(png)};
const recipe={schemaVersion:'image-tool-edit-state/v1',source:sourceRef,layers:[{id:'l1',kind:'raster',artifactId:'layer-one',frame:{x:3,y:4,width:32,height:24},zIndex:1,opacity:1},{id:'text1',kind:'text',text:{content:'可编辑文字',confidence:.8,style:{fontFamily:'sans-serif',fontSize:16,color:'#224466'}},frame:{x:1,y:2,width:40,height:20},zIndex:2,reviewRequired:true}]};
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><path d="M0 0H64V48H0Z" fill="#44aa77"/></svg>');
const dense={schemaVersion:'image-mockup-surface/v1',provider:'b-sam2-moge',width:4,height:4,uv:Buffer.alloc(16*8).toString('base64'),mask:Buffer.alloc(16,255).toString('base64'),recognitionVersion:7};
const data=[{id:'layer-one',role:'layer',mime:'image/png',content:layer,width:32,height:24},{id:'mask-one',role:'mask',mime:'image/png',content:png,width:64,height:48},{id:'preview-one',role:'preview',mime:'image/png',content:png,width:64,height:48},{id:'vector-one',role:'vector',mime:'image/svg+xml',content:svg,width:64,height:48},{id:'surface-one',role:'surface',mime:'application/json',content:Buffer.from(JSON.stringify(dense))},{id:'recipe-one',role:'edit-state',mime:'application/json',content:Buffer.from(JSON.stringify(recipe))}];
const begin={scope,actorId,idempotencyKey:'artifact-proof',requestDigest:sha(JSON.stringify(recipe)),tool:'layering',source:sourceRef,params:{maxLayers:2}};
const accepted=await first.store.begin(begin);const complete=await first.store.commit(scope,accepted.id,actorId,data,{editStateArtifactId:'recipe-one'});if(complete.status!=='committed')throw Error('Not committed');await first.state.flush();
// Construct entirely fresh cloud state/client-backed projections; no reuse of in-memory slots or image caches.
const restored=await build(false),record=await restored.store.read(scope,accepted.id,actorId);if(record?.status!=='committed'||!record.manifest)throw Error('Cloud record not restored');
const checked=[];for(const artifact of record.manifest.artifacts){const actual=await restored.files.read(scope,artifact.path),expected=data.find(v=>v.id===artifact.id);if(!actual||!expected||sha(actual.content)!==sha(expected.content))throw Error('Cloud byte readback mismatch');checked.push({id:artifact.id,role:artifact.role,mime:artifact.mime,path:artifact.path,bytes:actual.content.byteLength,sha256:artifact.sha256});}
const recipeArtifact=record.manifest.artifacts.find((v:{id:string})=>v.id==='recipe-one')!;const savedRecipe=JSON.parse(Buffer.from((await restored.files.read(scope,recipeArtifact.path))!.content).toString());if(savedRecipe.layers[1].text.content!=='可编辑文字'||savedRecipe.layers[0].frame.x!==3)throw Error('Edit state lost');
const beforeReplay=writes;const replay=await restored.store.commit(scope,accepted.id,actorId,data,{editStateArtifactId:'recipe-one'});if(writes!==beforeReplay||replay.revision!==record.revision)throw Error('Replay was not immutable');
let foreignDenied=false;try{await restored.files.read({...scope,namespace:'different-tenant'},recipeArtifact.path);}catch(e){foreignDenied=(e as {status?:number}).status===403;}if(!foreignDenied)throw Error('Foreign scope not denied');
const report={verifiedAt:new Date().toISOString(),projectId:id,executionId:accepted.id,status:record.status,cloudProject:'grworkspace',database:'canvas_app_dev',bucket:'canvas_assets_v2',binaryMode:'real Appwrite file upload/download; synthetic artifacts; no inference',checked,editStateRestored:true,freshProjectionRestored:true,replayWrites:writes-beforeReplay,foreignScopeDeniedByInjectedPolicy:foreignDenied,notClaimed:['production MA identity','production bucket privacy: existing development bucket still has read(users)','actual GPU/layering/OCR or mockup inference','public image.tool multi-artifact route or full UI integration']};
await mkdir(path.dirname(values.report!),{recursive:true});await writeFile(values.report!,JSON.stringify(report,null,2));console.log(JSON.stringify({projectId:id,status:record.status,artifacts:checked.length,editStateRestored:true,replayWrites:report.replayWrites,foreignScopeDeniedByInjectedPolicy:foreignDenied}));
