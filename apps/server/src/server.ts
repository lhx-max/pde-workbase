import {ImageEditReceipts} from './storage/image-edit-receipts.js';
import {createHash} from 'node:crypto';
import {CloudToolArtifactFiles} from './storage/cloud-tool-artifact-files.js';
import {currentRequestTenant} from './tenant.js';
import {canvasProjectMatchesAuthority} from './storage/canvas-project-scope.js';
import express, {type RequestHandler, type Response} from 'express';
import { timingSafeEqual } from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import type {Duplex} from 'node:stream';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { canvasTextPath } from '@bezier/contracts';
import { createProjectRegistry } from './storage/project-registry.js';
import { createCloudProjectRegistry } from './storage/cloud-project-registry.js';
import { createMaAuthority, type MaAuthorityOptions, type AppActor } from '@ks-designai/app-authority';
import {AppwriteJsonState,assertPrivateAppwriteStorage,type JsonStatePort} from '@ks-designai/app-cloud-state';
import {createCloudAssetLibrary} from './asset-library/cloud.js';
import { setVerifiedTenant, verifiedTenant } from './tenant.js';
import { CanvasStateService } from './canvas/state.js';
import {CanvasStateError} from './canvas/errors.js';
import { createDocSynchronizer } from './canvas/doc-sync.js';
import { FileCanvasContent } from './canvas/persistence.js';
import { isSketchDocumentPath, SketchAppFiles, SketchAppSketchStore } from './storage/sketch-app-files.js';
import { ProjectLedger } from './project-ledger/service.js';
import { withProjectLedgerRecorder } from './project-ledger/active-recorder.js';
import { registerCanvasStateRoutes } from './routes/canvas.js';
import { registerAppCanvasRoutes } from './routes/app-canvas.js';
import { registerCloudProjectFileRoutes } from './routes/cloud-project-files.js';
import {registerCloudProjectFileEvents} from './routes/cloud-project-file-events.js';
import {CloudArtifactMetadata} from './storage/cloud-artifact-metadata.js';
import { registerCloudProjectFileViews } from './routes/cloud-project-file-views.js';
import { CloudProjectFiles } from './storage/cloud-project-files.js';
import { registerProjectFileRoutes, type RegisterProjectFileRoutesDeps } from './routes/files.js';
import {Database} from './storage/database.js';
import {MediaAdapterService,type MediaAdapter} from './media/adapter-service.js';
import {ImageAppService} from './media/image-app.js';
import {registerImageAppRoutes} from './routes/app-image.js';
import {imageAppManifest} from '@ks-designai/image-card-pack/server';
import {registerMediaRoutes,type CapabilityAdapter} from './routes/media.js';
import {registerAssetRoutes,type AssetAdapter} from './routes/assets.js';
import {createLocalAssetLibrary,type AssetLibraryAdapter,type AssetLibraryOptions} from './asset-library/service.js';
import {registerAssetLibraryRoutes} from './routes/asset-library.js';
export type {AssetLibraryAdapter,AssetLibraryOptions,AssetLibraryAnalysisHook,AssetLibraryCatalogueHook} from './asset-library/service.js';
export type {AssetAdapter} from './routes/assets.js';
import {AppwriteClient} from './storage/appwrite-client.js';
import {CloudImageFiles} from './storage/cloud-image-files.js';
import {AppwriteCanvasFileContent, AppwriteCanvasPersistence} from './storage/canvas-appwrite-persistence.js';
import {appwriteCanvasEffects,readLocalProjectFile} from './storage/canvas-appwrite-effects.js';
import {CardRegistryStore} from './storage/card-registry.js';
import {AppRegistryStore} from './storage/app-registry.js';
import {canvasManifest} from './canvas-manifest.js';
import {AppEntitlementStore} from './storage/app-entitlements.js';
import {BindingStore} from './storage/bindings.js';
import {AuditLog} from './storage/audit-log.js';
import {registerAppsRoutes} from './routes/apps.js';
import {registerCanvasProviderRoutes} from './routes/canvas-provider.js';
import {registerIndependentImageRoutes} from './routes/independent-image.js';
import {IndependentImageClient} from './media/independent-image-client.js';
import {syncCardPackRegistry} from './card-packs.js';
import {ownsTenantAsset,tenantOf,runWithRequestTenant,appVisibleToTenant,type AuthorizeAppManagement} from './tenant.js';
export interface CanvasServerOptions {
 /** Trusted MA identity and instance authorization, using its published read contract. */
 authority?:MaAuthorityOptions;
 /** Explicit isolated/single-maintainer development only. Never use for shared deployment. */
 developmentActor?:{teamId:string;userId:string};
 dataRoot:string; host?:string; authToken?:string; allowedOrigins?:string[]; assets?:AssetAdapter;
 /** Explicit loopback-only Plugin Kit integration. Never use as production authentication. */
 providerLocalDevelopment?:boolean;
 media?:MediaAdapter; capabilities?:CapabilityAdapter; assetLibrary?:AssetLibraryOptions;
 /** Independent Image business authority; Canvas retains references/previews only. */
 independentImage?:{origin:string;applicationId:string};
 /** Canvas self-closed-loop backend: state/journal/canvas files on Appwrite
 * instead of the project filesystem. Task artifact features stay
 * file-based this phase. */
 appwrite?:{endpoint:string;projectId:string;databaseId:string;bucketId:string;apiKey?:string;sessionCookie?:string;sessionSecret?:string;sessionMode?:'admin';runtime?:{collectionId:string;namespace:string;singleWriter:boolean;initialize?:boolean}};
 authorize?:RequestHandler;
 /** Verified operator-role adapter. Authenticated deployments default to no governance access. */
 authorizeAppManagement?:AuthorizeAppManagement;
 /** Trusted server-side action policy over the MA-verified actor. No policy means read-only. */
 authorizeAction?:(actor:AppActor,action:string)=>boolean|Promise<boolean>;
 /** Exact origins permitted to receive the current caller's MA credentials. */
 trustedAppOrigins?:readonly string[]|undefined;
 /** Trusted injected port for isolated tests or another durable cloud adapter. */
 runtimeState?:JsonStatePort;
 /** Optional host read policy for long-lived streams; must revalidate without writing a response. */
 authorizeProjectStream?:(req:express.Request,projectId:string)=>boolean|Promise<boolean>;
 authorizeProject?:(req:express.Request,res:Response,projectId:string,access:{mode:'read'|'write';capability?:string})=>boolean|Promise<boolean>;
}
export interface CanvasServer {
 app:express.Express;registry:ReturnType<typeof createProjectRegistry>;canvas:CanvasStateService;ledger:ProjectLedger;media:MediaAdapterService;
 assetLibrary:AssetLibraryAdapter;db:Database;ready:Promise<void>;handleUpgrade(req:IncomingMessage,socket:Duplex,head:Buffer):void;close():Promise<void>;
}
export function createCanvasServer(options:CanvasServerOptions):CanvasServer {
 if(process.env.NODE_ENV==='production'&&options.authority&&options.media&&options.media.identityMode!=='verified-request')throw new CanvasStateError(503,'IMAGE_REQUEST_IDENTITY_REQUIRED','Multi-user production image execution requires verified request-bound model authorization');
 if(options.developmentActor&&process.env.NODE_ENV==='production')throw new Error('Development identity is forbidden in production');
 for(const origin of options.trustedAppOrigins??[]){const u=new URL(origin);if(u.origin!==origin||u.username||u.password||(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))))throw Error('trustedAppOrigins requires exact HTTP(S) origins');}
 if(options.independentImage&&(!options.authority||!options.trustedAppOrigins?.includes(options.independentImage.origin)))throw Error('Independent Image requires MA authority and an explicitly trusted Image origin');
 if(!options.dataRoot||!path.isAbsolute(options.dataRoot))throw new Error('An explicit absolute dataRoot is required');
 const dataRoot=path.resolve(options.dataRoot);mkdirSync(dataRoot,{recursive:true});
 if(options.appwrite&&!options.runtimeState&&!options.appwrite.runtime)throw new CanvasStateError(503,'CLOUD_RUNTIME_REQUIRED','Appwrite runtime collection, namespace and single-writer configuration are required');
 if(process.env.NODE_ENV==='production'&&options.appwrite?.runtime?.initialize)throw Error('Production runtime namespaces must be initialized by an explicit provisioning task');
 const privateStorageGate=options.appwrite&&process.env.NODE_ENV==='production'?assertPrivateAppwriteStorage({client:new AppwriteClient(options.appwrite),databaseId:options.appwrite.databaseId,bucketId:options.appwrite.bucketId,collectionIds:['canvases','canvas_files','canvas_operations','apps','card_packs','card_grants',...(options.appwrite.runtime?[options.appwrite.runtime.collectionId]:[])]}):Promise.resolve();
 void privateStorageGate.catch(()=>{});
 const appwriteClient=options.appwrite?new AppwriteClient(options.appwrite,privateStorageGate):undefined;
 const runtimeState=options.runtimeState??(appwriteClient&&options.appwrite?.runtime?new AppwriteJsonState({client:appwriteClient,databaseId:options.appwrite.databaseId,...options.appwrite.runtime}):undefined);
 void runtimeState?.ready.catch(()=>{});
 const registry=appwriteClient&&options.appwrite?createCloudProjectRegistry(dataRoot,appwriteClient,options.appwrite.databaseId):Object.assign(createProjectRegistry(dataRoot),{ready:Promise.resolve(),flush:async()=>{}});
 void registry.ready.catch(()=>{});
 const ledger=new ProjectLedger(dataRoot,runtimeState);
 const assetLibrary=options.assetLibrary?.adapter??(runtimeState&&appwriteClient&&options.appwrite?createCloudAssetLibrary({state:runtimeState,client:appwriteClient,bucketId:options.appwrite.bucketId,authorizeWrite:(actor,action)=>options.authorizeAction?.(actor as AppActor,action)??false}):createLocalAssetLibrary(dataRoot));
 const resolveProjectRoot=(id:string)=>registry.resolveProjectRoot(id);
 const appContent=options.appwrite&&appwriteClient?new AppwriteCanvasFileContent(appwriteClient,options.appwrite.databaseId,options.appwrite.bucketId):new FileCanvasContent(resolveProjectRoot);
 const appRegistry=new AppRegistryStore(appwriteClient,options.appwrite?.databaseId,path.join(dataRoot,'app-registry.json'),!options.appwrite,runtimeState);
 const canvasRegistration=appRegistry.register({appId:'canvas',name:'画布',endpoint:'/api/apps/canvas',status:'active',manifest:canvasManifest()});
 void canvasRegistration.catch(()=>{});
 const cardRegistry=appwriteClient&&options.appwrite?new CardRegistryStore(appwriteClient,options.appwrite.databaseId):undefined;
 const allowedKinds=async(projectId:string)=>cardRegistry?.resolveAllowedKinds({projectId,...(registry.get(projectId)?.teamId?{teamId:registry.get(projectId)!.teamId!}:{})});
 const appwriteStorage=options.appwrite&&appwriteClient?(()=>{const client=appwriteClient;const resolveRoot=(id:string)=>registry.resolveProjectRoot(id);syncCardPackRegistry(cardRegistry!).catch(err=>console.warn('[card-registry] pack sync failed:',err));const persistence=new AppwriteCanvasPersistence(client,options.appwrite!.databaseId);return {persistence:{load:async(id:string)=>{await registry.flush();return persistence.load(id);},commit:async(id:string,blob:Parameters<typeof persistence.commit>[1],operation?:string)=>{await registry.flush();await persistence.commit(id,blob,operation);},describe:(id:string)=>persistence.describe(id)},content:appContent!,effects:appwriteCanvasEffects(client,options.appwrite!.databaseId,options.appwrite!.bucketId,resolveRoot),cardEntitlement:allowedKinds};})():undefined;
 const sketchEndpoint=async()=>{const app=await appRegistry.get('sketch');return app&&app.status==='active'&&/^https?:\/\//.test(app.endpoint)?app.endpoint:null;};
 const sketchStore=async(projectId:string)=>{const endpoint=await sketchEndpoint();return endpoint?new SketchAppSketchStore(new SketchAppFiles(endpoint),projectId):null;};
 const entitlements=new AppEntitlementStore(dataRoot,runtimeState);
 const bindings=new BindingStore(dataRoot,runtimeState);
 const audit=new AuditLog(dataRoot,runtimeState);
 const textDocumentSynced=createDocSynchronizer({dataRoot,...(runtimeState?{state:runtimeState}:{}),requireVerifiedAuthority:Boolean(options.authority),registry:appRegistry,bindings,audit,entitlements,project:id=>registry.get(id)});
 const documentNodesChanged=async(projectId:string,nodes:readonly Record<string,unknown>[])=>{bindings.reconcileNodes(projectId,nodes);await runtimeState?.flush();};
 const canvas=new CanvasStateService(id=>registry.resolveProjectRoot(id),undefined,assetLibrary,{...appwriteStorage,sketchStore,textDocumentSynced,documentNodesChanged,textDocumentPrepared:async(...args)=>{textDocumentSynced.prepare(...args);await runtimeState?.flush();},documentMirrorSaved:textDocumentSynced.confirmMirror});
 textDocumentSynced.attach(canvas);
 const db=new Database(runtimeState?':memory:':path.join(dataRoot,'workspace.sqlite'));
 db.exec('CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY)');
 for(const project of registry.list())db.prepare('INSERT OR IGNORE INTO projects(id) VALUES (?)').run(project.id);
 const imageFiles=appwriteClient&&options.appwrite?new CloudImageFiles(appwriteClient,options.appwrite.databaseId,options.appwrite.bucketId):undefined;
 const toolArtifacts=appwriteClient&&runtimeState&&imageFiles&&options.appwrite?new CloudToolArtifactFiles({client:appwriteClient,state:runtimeState,images:imageFiles,bucketId:options.appwrite.bucketId,authorize:async(scope,mode)=>{
  if(!['media-tools','image-edit'].includes(scope.namespace))throw new CanvasStateError(403,'IMAGE_TOOL_SCOPE_DENIED','Unknown tool storage scope');
  const project=registry.get(scope.projectId),actor=currentRequestTenant();
  if(!project||actor&&(!ownsTenantAsset(project,actor)||actor.userVerified&&!canvasProjectMatchesAuthority(project,actor as import('@ks-designai/app-authority').AppActor)))throw new CanvasStateError(403,'IMAGE_TOOL_SCOPE_DENIED','Tool resource does not belong to this project');
  if(mode==='write'&&project.archivedAt)throw new CanvasStateError(409,'CANVAS_ARCHIVED','Archived canvas is read-only');
 }}):undefined;
 const media=new MediaAdapterService(db,registry,canvas,options.media,imageFiles,runtimeState?{state:runtimeState,...(toolArtifacts?{toolArtifacts}:{})}:undefined);
 const imageApp=new ImageAppService(canvas,media,toolArtifacts&&imageFiles&&runtimeState?{
  receipts:new ImageEditReceipts(runtimeState),
  save:async(projectId,path,document)=>{await toolArtifacts.put({namespace:'image-edit',projectId},{id:createHash('sha256').update(path).digest('hex'),role:'edit-state',path,mime:'application/json',content:Buffer.from(JSON.stringify(document))});},
  read:async(projectId,path)=>{const value=await toolArtifacts.read({namespace:'image-edit',projectId},path);if(!value)throw new CanvasStateError(404,'IMAGE_EDIT_NOT_FOUND','工程文件不存在');return JSON.parse(Buffer.from(value.content).toString('utf8'));},
  readArtifact:async(projectId,path)=>{const value=await toolArtifacts.read({namespace:'media-tools',projectId},path);if(!value)throw new CanvasStateError(404,'IMAGE_TOOL_ARTIFACT_NOT_FOUND','工具产物不存在');return JSON.parse(Buffer.from(value.content).toString('utf8'));},
  validatePath:async(projectId,path)=>{if(!await imageFiles.read(projectId,path))throw new CanvasStateError(404,'IMAGE_EDIT_RESOURCE_NOT_FOUND','工程引用的图片不存在');}
 }:undefined);
 const imageRegistration=options.independentImage?appRegistry.register({appId:'image',name:'图片',endpoint:options.independentImage.origin+'/api/apps/image',status:'active',manifest:{appId:'image',instanceScope:'image-owned-workspace',storage:{authority:'image-app',canvasBusinessState:false}}}):options.media?appRegistry.register({appId:'image',name:'图片',endpoint:'/api/apps/image',status:'active',manifest:imageAppManifest}):Promise.resolve();
 void imageRegistration.catch(()=>{});
 const app=express();app.disable('x-powered-by');
 const resolveAuthority=options.authority?createMaAuthority(options.authority):undefined;
 app.use(async(_req,res,next)=>{
  try {
   await ready; await runtimeState?.flush();
   const json=res.json.bind(res); let pending=false;
   res.json=((body:unknown)=>{
    if(pending||res.headersSent)return res;
    pending=true; const status=res.statusCode;
    void Promise.all([registry.flush(),runtimeState?.flush()]).then(()=>{
     res.json=json; if(!res.headersSent)json.call(res.status(status),body);
    }).catch(error=>{res.json=json;next(error);});
    return res;
   }) as typeof res.json;
   next();
  }catch(error){next(error);}
 });
 const sendApiError=(res:Response,status:number,code:string,message:string)=>{res.status(status).json({error:{code,message}});};
 const authorize:RequestHandler=(req,res,next)=>{
  let requestHost:URL;try{requestHost=new URL(`http://${req.get('host')??''}`);}catch{sendApiError(res,403,'HOST_FORBIDDEN','Invalid request host');return;}
  const primaryHost=options.host??'127.0.0.1';const poweredHost=primaryHost==='localhost'?'127.0.0.1':primaryHost==='127.0.0.1'?'localhost':null;
  if(!options.authToken&&!options.authority&&!['localhost','127.0.0.1','[::1]'].includes(requestHost.hostname)){sendApiError(res,403,'HOST_FORBIDDEN','Request host is not loopback');return;}
  const browserMetadata=['sec-fetch-site','sec-fetch-mode','sec-fetch-dest'].some(key=>req.headers[key]!==undefined);
  let poweredReferer=false;try{const ref=new URL(req.get('referer')??'');poweredReferer=ref.hostname===poweredHost&&ref.port===requestHost.port&&/^\/api\/projects\/[^/]+\/powered\/.+/.test(ref.pathname);}catch{}
  if(requestHost.hostname===poweredHost&&(browserMetadata||poweredReferer)&&!/^\/api\/projects\/[^/]+\/powered\/.+/.test(req.path)){sendApiError(res,403,'POWERED_PREVIEW_FORBIDDEN','Powered preview origin cannot access this API route');return;}
  if(options.authToken&&req.method!=='OPTIONS'){const value=req.headers.authorization?.replace(/^Bearer /,'')??'';const a=Buffer.from(value),b=Buffer.from(options.authToken);if(a.length!==b.length||!timingSafeEqual(a,b)){sendApiError(res,401,'UNAUTHORIZED','Authentication required');return;}}
  const origin=req.get('origin');if(origin){
   if(origin==='null'&&req.method==='GET'&&/^\/api\/projects\/[^/]+\/(?:raw|preview)\//.test(req.path)){next();return;}
   let allowed=false;try{const url=new URL(origin);allowed=(options.allowedOrigins??[]).includes(url.origin)||url.host===req.get('host');}catch{}
   if(!allowed){sendApiError(res,403,'ORIGIN_FORBIDDEN','Origin is not allowed');return;}
   res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Credentials','true');res.vary('Origin');
   res.setHeader('Access-Control-Expose-Headers','ETag, X-Content-Revision');
   res.setHeader('Access-Control-Allow-Methods','GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
   res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, Idempotency-Key, X-Browser-Resource-Token, X-MAV-SSO-Authorization, X-MAV-Tenant, X-MAV-Application-Instance-Id');
  }
  next();
 };
 const authorizeProjectRequest=async(req:express.Request,res:Response,projectId:string,access:{mode:'read'|'write';capability?:string}={mode:'read'})=>{
   const creating=req.method==='POST'&&(req.path==='/api/projects'||req.path==='/api/apps/canvas/actions/canvas.create'||((options.providerLocalDevelopment===true||Boolean(verifiedTenant(req)))&&/^\/open-platform\/v1\/instances\/[^/]+\/actions\/canvas\.create$/.test(req.path)));
  if(!creating&&!registry.get(projectId)){sendApiError(res,404,'PROJECT_NOT_FOUND','Project not found');return false;}
  const project=registry.get(projectId);
   if(project&&!ownsTenantAsset(project,tenantOf(req))){sendApiError(res,403,'TENANT_FORBIDDEN','Asset belongs to another team');return false;}
   const actor=verifiedTenant(req);
   if(project&&actor){
    if(!canvasProjectMatchesAuthority(project,actor)){sendApiError(res,403,'INSTANCE_FORBIDDEN','Canvas does not belong to the verified MA instance');return false;}
   }
   if(entitlements.resolve('canvas',tenantOf(req))==='deny'){sendApiError(res,403,'TENANT_FORBIDDEN','App denied for this tenant');return false;}
   const repeatArchive=req.method==='POST'&&req.params.actionId==='canvas.delete'&&req.params.instanceId===projectId;
   if(project?.archivedAt&&access.mode==='write'&&!repeatArchive){sendApiError(res,409,'CANVAS_ARCHIVED','Archived canvas is read-only');return false;}
   if(actor&&access.mode==='write'&&!options.authorizeProject){
    const action=/\/actions\/([a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9.-]*)$/.exec(req.path)?.[1]
      ??(req.path.endsWith('/operations')?'canvas.operations':'canvas.write');
    if(!options.authorizeAction||!await options.authorizeAction(actor,action)){
     sendApiError(res,403,'APP_WRITE_FORBIDDEN','Verified identity has no delegated permission for this action');return false;
    }
   }
   return options.authorizeProject?await options.authorizeProject(req,res,projectId,access):true;
 };
 const projectStreamAuthorized=async(req:express.Request,projectId:string):Promise<boolean>=>{
  try{
   const project=registry.get(projectId);if(!project)return false;
   const initial=verifiedTenant(req);const fresh=resolveAuthority?await resolveAuthority(req.headers):initial;
   if(resolveAuthority&&(!initial||!fresh||(['teamId','userId','bizId','applicationId','applicationInstanceId','providerInstanceId'] as const).some(key=>initial[key]!==fresh[key])))return false;
   const tenant=fresh??tenantOf(req);if(!ownsTenantAsset(project,tenant)||entitlements.resolve('canvas',tenant)==='deny')return false;
   if(fresh&&!canvasProjectMatchesAuthority(project,fresh))return false;
   // A one-shot response-writing host guard cannot safely authorize an open
   // stream. Such embedders must supply the explicit current-read predicate.
   if(options.authorizeProject&&!options.authorizeProjectStream)return false;
   return options.authorizeProjectStream?await options.authorizeProjectStream(req,projectId):true;
  }catch{return false;}
 };
 app.use(authorize);
 if(options.authorize)app.use(options.authorize);
 app.use(async(req,res,next)=>{
  if(req.path==='/api/health'||req.method==='OPTIONS'){next();return;}
  try{
   if(resolveAuthority){setVerifiedTenant(req,await resolveAuthority(req.headers));if(req.method==='POST'&&req.path==='/api/projects'){sendApiError(res,403,'HOST_INSTANCE_REQUIRED','Use the App instance creation contract in MA mode');return;}}
   else if(options.appwrite&&!options.developmentActor){sendApiError(res,503,'AUTHORITY_REQUIRED','Cloud deployment requires a verified MA authority; no header identity fallback');return;}
   else if(options.developmentActor){req.headers['x-team-id']=options.developmentActor.teamId;req.headers['x-user-id']=options.developmentActor.userId;}
   if(verifiedTenant(req)&&req.path==='/api/media/config'&&!['GET','HEAD','OPTIONS'].includes(req.method)&&!await options.authorizeAppManagement?.(req)){sendApiError(res,403,'OPERATOR_REQUIRED','Shared media configuration requires verified operator authority');return;}
   next();
  }catch(error){next(error);}
 });
  // Capture identity only after the trusted host adapter has rewritten it.
  app.use((req,_res,next)=>runWithRequestTenant(tenantOf(req),next,verifiedTenant(req)?Object.fromEntries(['x-mav-sso-authorization','x-mav-tenant','x-mav-application-instance-id'].flatMap(key=>typeof req.headers[key]==='string'?[[key,req.headers[key] as string]]:[])):{},options.trustedAppOrigins));
 app.use(async(req,res,next)=>{
  try{const scoped=/^\/api\/projects\/([^/]+)(?:\/|$)/.exec(req.path);
   const globalTask=/^\/api\/(?:media\/tasks|image-tasks)\/([^/]+)(?:\/|$)/.exec(req.path);
   const projectId=scoped?.[1]?decodeURIComponent(scoped[1]):globalTask?.[1]?media.get(decodeURIComponent(globalTask[1]))?.projectId:undefined;
   const mediaWait=req.method==='POST'&&/^\/api\/(?:media\/tasks\/[^/]+|projects\/[^/]+\/media\/tasks\/[^/]+)\/wait$/.test(req.path);
   if(projectId&&!await authorizeProjectRequest(req,res,projectId,{mode:mediaWait||['GET','HEAD','OPTIONS'].includes(req.method)?'read':'write'}))return;next();
  }catch(error){next(error);}
 });
 app.use((req,res,next)=>{if(req.method==='OPTIONS'){res.status(204).end();return;}next();});
 app.use(express.json({limit:'64mb'}));
 app.use((_req,_res,next)=>withProjectLedgerRecorder(input=>{ledger.record(input);},next));
 app.get('/api/health',(_req,res)=>res.json({ok:true,service:'canvas-workspace',storage:{
  canvas:options.appwrite?'appwrite':'explicit-local-runtime',images:imageFiles?'appwrite':'explicit-local-runtime',
  // These stores still contain durable business state; do not call them disposable caches.
  runtimeMetadata:runtimeState?'appwrite':'explicit-local-runtime',localAuthority:runtimeState?[]:['bindings','document-sync-journal','media-task-journal','app-entitlements','asset-library'],
  cloudAcceptance:options.appwrite?'runtime-recovery-configured-awaiting-acceptance':'not-applicable',
  authorization:options.authority?'ma-verified':options.developmentActor?'explicit-development-actor':options.authorize?'host-verified':options.appwrite?'authority-required':'local-development',
 }}));
 registerCanvasStateRoutes(app,{canvasState:canvas,ledger,resolveProjectRoot:id=>registry.resolveProjectRoot(id),authorizeProjectRequest});
 if(options.independentImage&&resolveAuthority){
  const imageClient=new IndependentImageClient({...options.independentImage,resolveTarget:headers=>resolveAuthority(headers)});
  registerIndependentImageRoutes(app,{client:imageClient,canvas,authorize:authorizeProjectRequest,allowImage:async(req,projectId,write)=>{
   const row=await appRegistry.get('image');if(!row||row.status!=='active'||!appVisibleToTenant(row,tenantOf(req))||entitlements.resolve('image',tenantOf(req))==='deny')throw new CanvasStateError(403,'IMAGE_APP_FORBIDDEN','Image App is unavailable');
   if(write){const kinds=await allowedKinds(projectId);if(kinds&&!kinds.includes('*')&&!kinds.includes('image'))throw new CanvasStateError(403,'CARD_KIND_NOT_ALLOWED','Image references are not allowed in this canvas');}
  }});
 }else registerImageAppRoutes(app,{service:imageApp,authorize:authorizeProjectRequest,apps:appRegistry,entitlements,audit,allowedKinds});
 registerAppsRoutes(app,{registry:appRegistry,entitlements,audit,...(options.authorizeAppManagement?{authorizeAppManagement:options.authorizeAppManagement}:(options.authToken||options.authorize||options.authority||options.appwrite)?{authorizeAppManagement:()=>false}:{})});
 registerAppCanvasRoutes(app,{canvasState:canvas,registry,authorizeProjectRequest,isStreamAuthorized:projectStreamAuthorized,appRegistry,content:appContent,ledger,bindings,audit,entitlements,documentSync:textDocumentSynced,allowedKinds,...(runtimeState?{runtimeState}: {})});
 registerCanvasProviderRoutes(app,{canvasState:canvas,registry,authorizeProjectRequest,providerLocalDevelopment:options.providerLocalDevelopment,verifiedActor:verifiedTenant});
 const projectFileDeps:RegisterProjectFileRoutesDeps={registry,canvasFiles:canvas,authorize:authorizeProjectRequest,...(imageFiles?{imageFiles}:{}),
  guardLegacyFileWrite:async(projectId,file)=>{
    const active=new Set(bindings.list({canvasInstanceId:projectId,appId:'doc'}).map(binding=>binding.nodeId));
    if(!active.size)return;
    const snapshot=await canvas.read(projectId);
    const nodes=Array.isArray(snapshot.state.workbenchBasicNodes)?snapshot.state.workbenchBasicNodes:[];
    // The index mirrorPath can lag a canvas rename/fork. Current card identity
    // and path, not that historical pointer, determine the protected mirror.
    if(nodes.some(node=>node&&node.kind==='text'&&typeof node.id==='string'&&active.has(node.id)
      &&(typeof node.projectFilePath==='string'?node.projectFilePath:canvasTextPath(node.id))===file)){
      throw Object.assign(new Error('Edit this document through its canvas card, Doc editor, or versioned App files channel'),{status:428,code:'DOC_WRITE_CHANNEL_REQUIRED'});
    }
  },sketchDocuments:{
  async read(filePath){const endpoint=await sketchEndpoint();if(!endpoint||!isSketchDocumentPath(filePath))return undefined;return new SketchAppFiles(endpoint).read(filePath);},
  async write(filePath,content){const endpoint=await sketchEndpoint();if(!endpoint||!isSketchDocumentPath(filePath))return undefined;const saved=await new SketchAppFiles(endpoint).write(filePath,content);return {name:saved.path,path:saved.path,size:saved.size,mtime:Date.parse(saved.updatedAt)||Date.now(),kind:'sketch',mime:'application/json',type:'file'};},
  async listed(projectId){const endpoint=await sketchEndpoint();if(!endpoint)return [];const snapshot=await canvas.read(projectId);const nodes=Array.isArray(snapshot.state.workbenchBasicNodes)?snapshot.state.workbenchBasicNodes:[];const client=new SketchAppFiles(endpoint);const out=[];for(const node of nodes){if(!node||typeof node!=='object')continue;const row=node as {kind?:unknown;projectFilePath?:unknown};if(row.kind!=='sketch'||typeof row.projectFilePath!=='string'||!isSketchDocumentPath(row.projectFilePath))continue;const meta=await client.meta(row.projectFilePath);if(!meta)continue;out.push({name:row.projectFilePath,path:row.projectFilePath,size:meta.size,mtime:Date.parse(meta.updatedAt)||Date.now(),kind:'sketch' as const,mime:'application/json',type:'file' as const});}return out;},
 }};
 if(appwriteClient&&options.appwrite&&runtimeState){
  const files=new CloudProjectFiles(appwriteClient,options.appwrite.databaseId,options.appwrite.bucketId,runtimeState);
  registerCloudProjectFileEvents(app,{files,registry,isAuthorized:projectStreamAuthorized});
  registerCloudProjectFileViews(app,{files,state:runtimeState,dataRoot,registry,authorize:authorizeProjectRequest});
  registerCloudProjectFileRoutes(app,{...projectFileDeps,files,artifacts:new CloudArtifactMetadata(runtimeState),authorize:authorizeProjectRequest});
 }
 registerProjectFileRoutes(app,projectFileDeps);
 registerMediaRoutes(app,{media,registry,authorizeGeneration:async(id,input)=>{if(options.independentImage&&input.surface!=='video'&&input.surface!=='audio')throw Object.assign(new Error('Image generation is owned by the independent Image App'),{status:409,code:'IMAGE_APP_REQUIRED'});const allowed=await allowedKinds(id);if(!allowed||allowed.includes('*'))return;const delivery=input.canvasDelivery as {nodeId?:string}|undefined;const snapshot=delivery?.nodeId?await canvas.read(id):undefined;const node=Array.isArray(snapshot?.state.workbenchBasicNodes)?snapshot.state.workbenchBasicNodes.find((node:{id?:string})=>node.id===delivery?.nodeId):undefined;const kind=typeof node?.kind==='string'?node.kind:String(input.surface);if(['image','video','storyboard','presentation'].includes(kind)&&!allowed.includes(kind))throw Object.assign(new Error('Card kind not granted for generation'),{status:403,code:'CARD_KIND_NOT_ALLOWED'});},...(options.capabilities?{capabilities:options.capabilities}:{})});
 registerAssetRoutes(app,{registry,library:assetLibrary,...(options.assets?{adapter:options.assets}:{})});
 registerAssetLibraryRoutes(app,{...options.assetLibrary,service:assetLibrary,registry,authorizeProject:authorizeProjectRequest});
 app.use((error:unknown,_req:express.Request,res:Response,_next:express.NextFunction)=>{const value=error as {status?:number;code?:string;message?:string};sendApiError(res,value.status??500,value.code??'SERVER_ERROR',value.message??'Internal server error');});
 const ready=withProjectLedgerRecorder(input=>{ledger.record(input);},async()=>{await privateStorageGate;await runtimeState?.ready;await registry.ready;await canvasRegistration;await imageRegistration;for(const project of registry.list())db.prepare('INSERT OR IGNORE INTO projects(id) VALUES (?)').run(project.id);await media.ready();await runtimeState?.flush();textDocumentSynced.start();});
 const handleUpgrade=(_req:IncomingMessage,socket:Duplex,_head:Buffer):void=>{
  socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
 };
 return {app,registry,canvas,ledger,media,assetLibrary,db,ready,handleUpgrade,close:async()=>{const failures:unknown[]=[];for(const stop of [()=>textDocumentSynced.close(),()=>media.close(),()=>assetLibrary.close?.(),()=>registry.flush(),()=>runtimeState?.flush()]){try{await stop();}catch(error){failures.push(error);}}db.close();if(failures.length)throw failures[0];}};
}
