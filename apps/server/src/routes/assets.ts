import {lstat} from 'node:fs/promises';
import path from 'node:path';
import type {Express,Response} from 'express';
import type {CanvasAssetSourceDescriptor} from '@bezier/contracts';
import type {ProjectRegistry} from '../storage/project-registry.js';
import {writeProjectFile,sanitizePath} from '../projects.js';
import {assertProjectPathHasNoSymlinks} from '../project-layout.js';
import type {AssetLibraryAdapter} from '../asset-library/service.js';
export interface AssetAdapter {
 list(projectId:string,query:Record<string,unknown>):Promise<unknown>;
 import(projectId:string,reference:unknown):Promise<{files:Array<{path:string;content:Uint8Array}>}>;
}
export function registerAssetRoutes(app:Express,deps:{registry:ProjectRegistry;adapter?:AssetAdapter;library?:AssetLibraryAdapter}):void {
 const {registry,adapter}=deps;
 const requireProject=(id:string,res:Response)=>{if(registry.get(id))return true;res.status(404).json({error:{code:'PROJECT_NOT_FOUND',message:'Project not found'}});return false;};
 const unavailable=(res:Response)=>res.status(503).json({error:{code:'ASSET_ADAPTER_UNAVAILABLE',message:'No external asset adapter configured'}});
 app.get('/api/projects/:id/asset-sources',(req,res)=>{
  if(!requireProject(String(req.params.id),res))return;
  const sources:CanvasAssetSourceDescriptor[]=[{id:'project',name:'Project files',capabilities:{search:true,read:true,preview:true,write:true,versioned:true}},...(deps.library?[{id:'asset-library',name:deps.library.source.name,capabilities:{search:false,read:true,preview:true,write:true,versioned:true}}]:[]),...(adapter?[{id:'external',name:'External adapter',capabilities:{search:true,read:false,preview:false,write:false,versioned:false}}]:[])];
  res.json({sources:sources.map(source=>({...source,kind:source.id,capabilities:{...source.capabilities,list:true,import:source.id==='project'||source.id==='asset-library'||Boolean(adapter)}}))});
 });
 app.get('/api/projects/:id/external-assets',async(req,res,next)=>{
  const projectId=String(req.params.id);if(!requireProject(projectId,res))return;if(!adapter){unavailable(res);return;}
  try{res.json(await adapter.list(projectId,req.query));}catch(error){next(error);}
 });
 app.post('/api/projects/:id/external-assets/import',async(req,res)=>{
  const projectId=String(req.params.id);if(!requireProject(projectId,res))return;if(!adapter){unavailable(res);return;}
  const files:Array<Awaited<ReturnType<typeof writeProjectFile>>>=[];let attemptedPath:string|undefined;
  try{
   const delivery=await adapter.import(projectId,req.body);
   if(!Array.isArray(delivery.files)||!delivery.files.length||delivery.files.length>100)throw new Error('Asset adapter must return 1–100 files');
   const root=registry.resolveProjectRoot(projectId);let bytes=0;const paths=new Set<string>();
   const prepared=delivery.files.map(file=>{
    if(!(file.content instanceof Uint8Array))throw new Error('Asset adapter must return file bytes');
    bytes+=file.content.byteLength;if(bytes>100*1024*1024)throw new Error('Asset import exceeds 100 MB');
    const name=sanitizePath(file.path);if(paths.has(name))throw new Error('Duplicate asset output path');
    for(const previous of paths)if(name.startsWith(`${previous}/`)||previous.startsWith(`${name}/`))throw new Error('Asset file and directory paths conflict');
    paths.add(name);assertProjectPathHasNoSymlinks(root,name);return {path:name,content:file.content};
   });
   // Validate the entire batch before any publication; no destructive rollback.
   for(const file of prepared){try{await lstat(path.join(root,file.path));throw Object.assign(new Error('Asset output already exists'),{code:'EEXIST'});}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
   for(const file of prepared){attemptedPath=file.path;files.push(await writeProjectFile(registry.projectsRoot,projectId,file.path,Buffer.from(file.content),{overwrite:false},registry.get(projectId)?.metadata));}
   res.json({files});
  }catch(error){const value=error as {code?:string;message?:string;committedPath?:string};const partial=files.length>0||Boolean(attemptedPath&&value.committedPath===attemptedPath);res.status(partial||value.code==='EEXIST'?409:400).json({error:{code:partial?'ASSET_IMPORT_PARTIAL':'ASSET_IMPORT_FAILED',message:value.message??String(error)},files,...(attemptedPath?{attemptedPath}:{}),...(value.committedPath===attemptedPath&&attemptedPath?{publishedPaths:[...files.map(file=>file.path),attemptedPath]}:{})});}
 });
}
