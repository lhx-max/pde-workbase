import express, {type RequestHandler, type Response} from 'express';
import { timingSafeEqual } from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import type {Duplex} from 'node:stream';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { BrowserResourceError, type BrowserResourceCommand, type BrowserResourceResult } from '@bezier/contracts';
import { createProjectRegistry } from './storage/project-registry.js';
import { CanvasStateService } from './canvas/state.js';
import { ProjectLedger } from './project-ledger/service.js';
import { withProjectLedgerRecorder } from './project-ledger/active-recorder.js';
import { registerCanvasStateRoutes } from './routes/canvas.js';
import { registerAppCanvasRoutes } from './routes/app-canvas.js';
import { registerProjectFileRoutes } from './routes/files.js';
import { registerClipEditorRoutes } from './routes/clip-editor.js';
import { registerBrowserResourceRoutes } from './routes/browser-resources.js';
import {Database} from './storage/database.js';
import {MediaAdapterService,type MediaAdapter} from './media/adapter-service.js';
import {registerMediaRoutes,type CapabilityAdapter} from './routes/media.js';
import {registerAssetRoutes,type AssetAdapter} from './routes/assets.js';
import { BrowserPreferencesService } from './services/browser-preferences.js';
import { registerBrowserPreferenceRoutes } from './routes/browser-preferences.js';
import {createLocalAssetLibrary,type AssetLibraryAdapter,type AssetLibraryOptions} from './asset-library/service.js';
import {registerAssetLibraryRoutes} from './routes/asset-library.js';
export type {AssetLibraryAdapter,AssetLibraryOptions,AssetLibraryAnalysisHook,AssetLibraryCatalogueHook} from './asset-library/service.js';
export type {AssetAdapter} from './routes/assets.js';
import {AppwriteClient} from './storage/appwrite-client.js';
import {AppwriteCanvasFileContent, AppwriteCanvasPersistence} from './storage/canvas-appwrite-persistence.js';
import {appwriteCanvasEffects,readLocalProjectFile} from './storage/canvas-appwrite-effects.js';
import './card-packs.js';
export interface CanvasServerOptions {
 dataRoot:string; host?:string; authToken?:string; allowedOrigins?:string[]; assets?:AssetAdapter;
 media?:MediaAdapter; capabilities?:CapabilityAdapter; assetLibrary?:AssetLibraryOptions;
 /** Canvas self-closed-loop backend: state/journal/canvas files on Appwrite
 * instead of the project filesystem. Task artifact features stay
 * file-based this phase. */
 appwrite?:{endpoint:string;projectId:string;databaseId:string;bucketId:string;sessionCookie?:string;sessionSecret?:string};
 authorize?:RequestHandler;
 authorizeProject?:(req:express.Request,res:Response,projectId:string,access:{mode:'read'|'write';capability?:string})=>boolean|Promise<boolean>;
 browserResources?:(command:BrowserResourceCommand)=>Promise<BrowserResourceResult>;
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
 const appwriteStorage=options.appwrite?(()=>{const client=new AppwriteClient(options.appwrite!);const resolveRoot=(id:string)=>registry.resolveProjectRoot(id);return {persistence:new AppwriteCanvasPersistence(client,options.appwrite!.databaseId),content:new AppwriteCanvasFileContent(client,options.appwrite!.databaseId,options.appwrite!.bucketId,'canvas_files',(pid,rel)=>readLocalProjectFile(resolveRoot,pid,rel)),effects:appwriteCanvasEffects(client,options.appwrite!.databaseId,options.appwrite!.bucketId,resolveRoot)};})():undefined;
 const canvas=new CanvasStateService(id=>registry.resolveProjectRoot(id),undefined,assetLibrary,appwriteStorage);
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
  const creating=req.method==='POST'&&(req.path==='/api/projects'||req.path==='/api/apps/canvas/actions/canvas.create');
  if(!creating&&!registry.get(projectId)){sendApiError(res,404,'PROJECT_NOT_FOUND','Project not found');return false;}
  return options.authorizeProject?await options.authorizeProject(req,res,projectId,access):true;
 };
 app.use(authorize);
 if(options.authorize)app.use(options.authorize);
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
 registerAppCanvasRoutes(app,{canvasState:canvas,registry,authorizeProjectRequest});
 registerProjectFileRoutes(app,{registry,canvasFiles:canvas,authorize:authorizeProjectRequest});
 registerClipEditorRoutes(app,{registry,paths:{RUNTIME_DATA_DIR:dataRoot,PROJECTS_DIR:registry.projectsRoot},http:{sendApiError},authorizeProjectRequest});
 registerBrowserResourceRoutes(app,{registry,http:{requireLocalDaemonRequest:authorize},authorizeProjectRequest,...(options.browserResources?{desktopBrowserResources:options.browserResources}:{})});
 registerMediaRoutes(app,{media,registry,...(options.capabilities?{capabilities:options.capabilities}:{})});
 registerAssetRoutes(app,{registry,library:assetLibrary,...(options.assets?{adapter:options.assets}:{})});
 registerAssetLibraryRoutes(app,{...options.assetLibrary,service:assetLibrary,registry,authorizeProject:authorizeProjectRequest});
 registerBrowserPreferenceRoutes(app,new BrowserPreferencesService(db));
 app.use((error:unknown,_req:express.Request,res:Response,_next:express.NextFunction)=>{const value=error as {status?:number;code?:string;message?:string};sendApiError(res,value.status??500,value.code??'SERVER_ERROR',value.message??'Internal server error');});
 const ready=withProjectLedgerRecorder(input=>{ledger.record(input);},async()=>{await media.ready();});
 const handleUpgrade=(_req:IncomingMessage,socket:Duplex,_head:Buffer):void=>{
  socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
 };
 return {app,registry,canvas,ledger,media,assetLibrary,db,ready,handleUpgrade,close:async()=>{await media.close();await assetLibrary.close?.();db.close();}};
}
/** Native grants remain in the desktop host; HTTP only forwards validated commands. */
export function createBrowserHostAdapter(url:string,token:string):(command:BrowserResourceCommand)=>Promise<BrowserResourceResult>{
 const endpoint=new URL('/command',url);if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))throw new Error('Browser host must be loopback HTTP');
 return async command=>{
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(command),signal:AbortSignal.timeout(30000)});
  const value=await response.json() as {ok?:boolean;result?:BrowserResourceResult;error?:{code?:string}};
  if(!response.ok||!value.result)throw new BrowserResourceError((value.error?.code??'read-failed') as ConstructorParameters<typeof BrowserResourceError>[0], 'Browser resource host rejected request');
  return value.result;
 };
}
