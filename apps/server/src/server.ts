import express, {type RequestHandler, type Response} from 'express';
import { timingSafeEqual } from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import type {Duplex} from 'node:stream';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { canvasTextPath } from '@bezier/contracts';
import { createProjectRegistry } from './storage/project-registry.js';
import { CanvasStateService } from './canvas/state.js';
import { createDocSynchronizer } from './canvas/doc-sync.js';
import { FileCanvasContent } from './canvas/persistence.js';
import { isSketchDocumentPath, SketchAppFiles, SketchAppSketchStore } from './storage/sketch-app-files.js';
import { ProjectLedger } from './project-ledger/service.js';
import { withProjectLedgerRecorder } from './project-ledger/active-recorder.js';
import { registerCanvasStateRoutes } from './routes/canvas.js';
import { registerAppCanvasRoutes } from './routes/app-canvas.js';
import { registerProjectFileRoutes } from './routes/files.js';
import {Database} from './storage/database.js';
import {MediaAdapterService,type MediaAdapter} from './media/adapter-service.js';
import {registerMediaRoutes,type CapabilityAdapter} from './routes/media.js';
import {registerAssetRoutes,type AssetAdapter} from './routes/assets.js';
import {createLocalAssetLibrary,type AssetLibraryAdapter,type AssetLibraryOptions} from './asset-library/service.js';
import {registerAssetLibraryRoutes} from './routes/asset-library.js';
export type {AssetLibraryAdapter,AssetLibraryOptions,AssetLibraryAnalysisHook,AssetLibraryCatalogueHook} from './asset-library/service.js';
export type {AssetAdapter} from './routes/assets.js';
import {AppwriteClient} from './storage/appwrite-client.js';
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
import {syncCardPackRegistry} from './card-packs.js';
import {ownsTenantAsset,tenantOf,runWithRequestTenant,type AuthorizeAppManagement} from './tenant.js';
export interface CanvasServerOptions {
 dataRoot:string; host?:string; authToken?:string; allowedOrigins?:string[]; assets?:AssetAdapter;
 /** Explicit loopback-only Plugin Kit integration. Never use as production authentication. */
 providerLocalDevelopment?:boolean;
 media?:MediaAdapter; capabilities?:CapabilityAdapter; assetLibrary?:AssetLibraryOptions;
 /** Canvas self-closed-loop backend: state/journal/canvas files on Appwrite
 * instead of the project filesystem. Task artifact features stay
 * file-based this phase. */
 appwrite?:{endpoint:string;projectId:string;databaseId:string;bucketId:string;sessionCookie?:string;sessionSecret?:string};
 authorize?:RequestHandler;
 /** Verified operator-role adapter. Authenticated deployments default to no governance access. */
 authorizeAppManagement?:AuthorizeAppManagement;
 authorizeProject?:(req:express.Request,res:Response,projectId:string,access:{mode:'read'|'write';capability?:string})=>boolean|Promise<boolean>;
}
export interface CanvasServer {
 app:express.Express;registry:ReturnType<typeof createProjectRegistry>;canvas:CanvasStateService;ledger:ProjectLedger;media:MediaAdapterService;
 assetLibrary:AssetLibraryAdapter;db:Database;ready:Promise<void>;handleUpgrade(req:IncomingMessage,socket:Duplex,head:Buffer):void;close():Promise<void>;
}
export function createCanvasServer(options:CanvasServerOptions):CanvasServer {
 if(!options.dataRoot||!path.isAbsolute(options.dataRoot))throw new Error('An explicit absolute dataRoot is required');
 const dataRoot=path.resolve(options.dataRoot);mkdirSync(dataRoot,{recursive:true});
 const registry=createProjectRegistry(dataRoot), ledger=new ProjectLedger(dataRoot);
 const assetLibrary=options.assetLibrary?.adapter??createLocalAssetLibrary(dataRoot);
 const appwriteClient=options.appwrite?new AppwriteClient(options.appwrite):undefined;
 const resolveProjectRoot=(id:string)=>registry.resolveProjectRoot(id);
 const appContent=options.appwrite&&appwriteClient?new AppwriteCanvasFileContent(appwriteClient,options.appwrite.databaseId,options.appwrite.bucketId,'canvas_files',(pid,rel)=>readLocalProjectFile(resolveProjectRoot,pid,rel)):new FileCanvasContent(resolveProjectRoot);
 const appRegistry=new AppRegistryStore(appwriteClient,options.appwrite?.databaseId,path.join(dataRoot,'app-registry.json'));
 appRegistry.register({appId:'canvas',name:'画布',endpoint:'/api/apps/canvas',status:'active',manifest:canvasManifest()}).catch(err=>console.warn('[app-registry] canvas self-register failed:',err));
 const appwriteStorage=options.appwrite&&appwriteClient?(()=>{const client=appwriteClient;const resolveRoot=(id:string)=>registry.resolveProjectRoot(id);const cardRegistry=new CardRegistryStore(client,options.appwrite!.databaseId);syncCardPackRegistry(cardRegistry).catch(err=>console.warn('[card-registry] pack sync failed:',err));return {persistence:new AppwriteCanvasPersistence(client,options.appwrite!.databaseId),content:appContent!,effects:appwriteCanvasEffects(client,options.appwrite!.databaseId,options.appwrite!.bucketId,resolveRoot),cardEntitlement:(projectId:string)=>cardRegistry.resolveAllowedKinds({projectId})};})():undefined;
 const sketchEndpoint=async()=>{const app=await appRegistry.get('sketch');return app&&app.status==='active'&&/^https?:\/\//.test(app.endpoint)?app.endpoint:null;};
 const sketchStore=async(projectId:string)=>{const endpoint=await sketchEndpoint();return endpoint?new SketchAppSketchStore(new SketchAppFiles(endpoint),projectId):null;};
 const entitlements=new AppEntitlementStore(dataRoot);
 const bindings=new BindingStore(dataRoot);
 const audit=new AuditLog(dataRoot);
 const textDocumentSynced=createDocSynchronizer({dataRoot,registry:appRegistry,bindings,audit,entitlements,project:id=>registry.get(id)});
 const documentNodesChanged=(projectId:string,nodes:readonly Record<string,unknown>[])=>bindings.reconcileNodes(projectId,nodes);
 const canvas=new CanvasStateService(id=>registry.resolveProjectRoot(id),undefined,assetLibrary,{...appwriteStorage,sketchStore,textDocumentSynced,documentNodesChanged,textDocumentPrepared:textDocumentSynced.prepare,documentMirrorSaved:textDocumentSynced.confirmMirror});
 textDocumentSynced.attach(canvas);
 const db=new Database(path.join(dataRoot,'workspace.sqlite'));
 db.exec('CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY)');
 for(const project of registry.list())db.prepare('INSERT OR IGNORE INTO projects(id) VALUES (?)').run(project.id);
 const media=new MediaAdapterService(db,registry,canvas,options.media);
 const app=express();app.disable('x-powered-by');
 const sendApiError=(res:Response,status:number,code:string,message:string)=>{res.status(status).json({error:{code,message}});};
 const authorize:RequestHandler=(req,res,next)=>{
  let requestHost:URL;try{requestHost=new URL(`http://${req.get('host')??''}`);}catch{sendApiError(res,403,'HOST_FORBIDDEN','Invalid request host');return;}
  const primaryHost=options.host??'127.0.0.1';const poweredHost=primaryHost==='localhost'?'127.0.0.1':primaryHost==='127.0.0.1'?'localhost':null;
  if(!options.authToken&&!['localhost','127.0.0.1','[::1]'].includes(requestHost.hostname)){sendApiError(res,403,'HOST_FORBIDDEN','Request host is not loopback');return;}
  const browserMetadata=['sec-fetch-site','sec-fetch-mode','sec-fetch-dest'].some(key=>req.headers[key]!==undefined);
  let poweredReferer=false;try{const ref=new URL(req.get('referer')??'');poweredReferer=ref.hostname===poweredHost&&ref.port===requestHost.port&&/^\/api\/projects\/[^/]+\/powered\/.+/.test(ref.pathname);}catch{}
  if(requestHost.hostname===poweredHost&&(browserMetadata||poweredReferer)&&!/^\/api\/projects\/[^/]+\/powered\/.+/.test(req.path)){sendApiError(res,403,'POWERED_PREVIEW_FORBIDDEN','Powered preview origin cannot access this API route');return;}
  if(options.authToken&&req.method!=='OPTIONS'){const value=req.headers.authorization?.replace(/^Bearer /,'')??'';const a=Buffer.from(value),b=Buffer.from(options.authToken);if(a.length!==b.length||!timingSafeEqual(a,b)){sendApiError(res,401,'UNAUTHORIZED','Authentication required');return;}}
  const origin=req.get('origin');if(origin){
   if(origin==='null'&&req.method==='GET'&&/^\/api\/projects\/[^/]+\/(?:raw|preview)\//.test(req.path)){next();return;}
   let allowed=false;try{const url=new URL(origin);allowed=(options.allowedOrigins??[]).includes(url.origin)||url.host===req.get('host');}catch{}
   if(!allowed){sendApiError(res,403,'ORIGIN_FORBIDDEN','Origin is not allowed');return;}
   res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Credentials','true');res.vary('Origin');
   res.setHeader('Access-Control-Allow-Methods','GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS');
   res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization, X-Browser-Resource-Token');
  }
  next();
 };
 const authorizeProjectRequest=async(req:express.Request,res:Response,projectId:string,access:{mode:'read'|'write';capability?:string}={mode:'read'})=>{
  const creating=req.method==='POST'&&(req.path==='/api/projects'||req.path==='/api/apps/canvas/actions/canvas.create'||(options.providerLocalDevelopment===true&&/^\/open-platform\/v1\/instances\/[^/]+\/actions\/canvas\.create$/.test(req.path)));
  if(!creating&&!registry.get(projectId)){sendApiError(res,404,'PROJECT_NOT_FOUND','Project not found');return false;}
  const project=registry.get(projectId);
   if(project&&!ownsTenantAsset(project,tenantOf(req))){sendApiError(res,403,'TENANT_FORBIDDEN','Asset belongs to another team');return false;}
   if(entitlements.resolve('canvas',tenantOf(req))==='deny'){sendApiError(res,403,'TENANT_FORBIDDEN','App denied for this tenant');return false;}
   const repeatArchive=req.method==='POST'&&req.params.actionId==='canvas.delete'&&req.params.instanceId===projectId;
   if(project?.archivedAt&&access.mode==='write'&&!repeatArchive){sendApiError(res,409,'CANVAS_ARCHIVED','Archived canvas is read-only');return false;}
   return options.authorizeProject?await options.authorizeProject(req,res,projectId,access):true;
 };
 app.use(authorize);
 if(options.authorize)app.use(options.authorize);
  // Capture identity only after the trusted host adapter has rewritten it.
  app.use((req,_res,next)=>runWithRequestTenant(tenantOf(req),next));
 app.use(async(req,res,next)=>{
  try{const scoped=/^\/api\/projects\/([^/]+)(?:\/|$)/.exec(req.path);
   const globalTask=/^\/api\/(?:media\/tasks|image-tasks)\/([^/]+)(?:\/|$)/.exec(req.path);
   const projectId=scoped?.[1]?decodeURIComponent(scoped[1]):globalTask?.[1]?media.get(decodeURIComponent(globalTask[1]))?.projectId:undefined;
   if(projectId&&!await authorizeProjectRequest(req,res,projectId,{mode:['GET','HEAD','OPTIONS'].includes(req.method)?'read':'write'}))return;next();
  }catch(error){next(error);}
 });
 app.use((req,res,next)=>{if(req.method==='OPTIONS'){res.status(204).end();return;}next();});
 app.use(express.json({limit:'64mb'}));
 app.use((_req,_res,next)=>withProjectLedgerRecorder(input=>{ledger.record(input);},next));
 app.get('/api/health',(_req,res)=>res.json({ok:true,service:'canvas-workspace'}));
 registerCanvasStateRoutes(app,{canvasState:canvas,ledger,resolveProjectRoot:id=>registry.resolveProjectRoot(id),authorizeProjectRequest});
 registerAppsRoutes(app,{registry:appRegistry,entitlements,audit,...(options.authorizeAppManagement?{authorizeAppManagement:options.authorizeAppManagement}:(options.authToken||options.authorize)?{authorizeAppManagement:()=>false}:{})});
 registerAppCanvasRoutes(app,{canvasState:canvas,registry,authorizeProjectRequest,appRegistry,content:appContent,ledger,bindings,audit,entitlements,documentSync:textDocumentSynced});
 registerCanvasProviderRoutes(app,{canvasState:canvas,registry,authorizeProjectRequest,providerLocalDevelopment:options.providerLocalDevelopment});
 registerProjectFileRoutes(app,{registry,canvasFiles:canvas,authorize:authorizeProjectRequest,
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
  async listed(projectId){const endpoint=await sketchEndpoint();if(!endpoint)return [];const snapshot=await canvas.read(projectId);const nodes=Array.isArray(snapshot.state.workbenchBasicNodes)?snapshot.state.workbenchBasicNodes:[];const client=new SketchAppFiles(endpoint);const out=[];for(const node of nodes){if(!node||typeof node!=='object')continue;const row=node as {kind?:unknown;projectFilePath?:unknown};if(row.kind!=='sketch'||typeof row.projectFilePath!=='string'||!isSketchDocumentPath(row.projectFilePath))continue;const meta=await client.meta(row.projectFilePath);if(!meta)continue;out.push({name:meta.path,path:meta.path,size:meta.size,mtime:Date.parse(meta.updatedAt)||Date.now(),kind:'sketch' as const,mime:'application/json',type:'file' as const});}return out;},
 }});
 registerMediaRoutes(app,{media,registry,...(options.capabilities?{capabilities:options.capabilities}:{})});
 registerAssetRoutes(app,{registry,library:assetLibrary,...(options.assets?{adapter:options.assets}:{})});
 registerAssetLibraryRoutes(app,{...options.assetLibrary,service:assetLibrary,registry,authorizeProject:authorizeProjectRequest});
 app.use((error:unknown,_req:express.Request,res:Response,_next:express.NextFunction)=>{const value=error as {status?:number;code?:string;message?:string};sendApiError(res,value.status??500,value.code??'SERVER_ERROR',value.message??'Internal server error');});
 const ready=withProjectLedgerRecorder(input=>{ledger.record(input);},async()=>{await media.ready();textDocumentSynced.start();});
 const handleUpgrade=(_req:IncomingMessage,socket:Duplex,_head:Buffer):void=>{
  socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
 };
 return {app,registry,canvas,ledger,media,assetLibrary,db,ready,handleUpgrade,close:async()=>{await textDocumentSynced.close();await media.close();await assetLibrary.close?.();db.close();}};
}
