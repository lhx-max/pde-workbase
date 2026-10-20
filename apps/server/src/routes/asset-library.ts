// Original-compatible asset HTTP shapes adapted from Bezier/Loom 319e5eee (Apache-2.0).
// No account/team/package platform services are part of this independent library.
import type {Express, Request, RequestHandler, Response} from 'express';
import multer from 'multer';
import JSZip from 'jszip';
import path from 'node:path';
import {assetMetadataYaml, type PersonalAssetCreate, type PersonalAssetAnalysisRequest, type AssetLibraryImportRequest, type AssetLibrarySaveRequest, type PersonalAssetUse} from '@bezier/contracts';
import {PersonalAssetError, inferPersonalAssetKind} from '../asset-library/core.js';
import {assetLibraryInfo, type AssetLibraryAdapter, type AssetLibraryOptions} from '../asset-library/service.js';
import type {ProjectRegistry} from '../storage/project-registry.js';
import {readProjectFile, resolveProjectFilePath, writeProjectFile, sanitizePath} from '../projects.js';
import {assertProjectPathHasNoSymlinks} from '../project-layout.js';

interface Deps extends AssetLibraryOptions {
  service:AssetLibraryAdapter;
  registry:ProjectRegistry;
  authorizeProject:(req:Request,res:Response,id:string,access:{mode:'read'|'write'})=>boolean|Promise<boolean>;
}
const base='/api/asset-library';
const route=(fn:RequestHandler):RequestHandler=>async(req,res,next)=>{
  try { await fn(req,res,next); } catch(error) {
    const value=error as {status?:number;code?:string;message?:string};
    const status=error instanceof PersonalAssetError?error.status:value.status??500;
    res.status(status).json({error:{code:'ASSET_LIBRARY_ERROR',message:error instanceof PersonalAssetError?error.message:status<500?value.message:'Asset library operation failed'}});
  }
};
const body=(req:Request):Record<string,any>=>{
  if(!req.body || typeof req.body!=='object' || Array.isArray(req.body)) throw new PersonalAssetError(400,'Expected an object body');
  return req.body;
};
const textQuery=(value:unknown,fallback?:string):string|undefined=>{
  if(value===undefined)return fallback;
  if(typeof value!=='string')throw new PersonalAssetError(400,'Expected a string query parameter');
  return value;
};
const unavailable=(res:Response,capability:'analysis'|'catalogue')=>res.status(503).json({error:{code:'ASSET_LIBRARY_CAPABILITY_UNAVAILABLE',message:`Asset library ${capability} is not configured`,capability}});
const safeEntry=(name:string):string=>{
  if(typeof name!=='string'||!name.trim()||name==='.'||name==='..'||/[\x00-\x1f/\\]/.test(name))throw new PersonalAssetError(400,'Unsafe asset filename');
  return name;
};
const projectPath=(value:unknown):string=>{
  try { return sanitizePath(value); } catch { throw new PersonalAssetError(400,'Invalid project file path'); }
};
const noProjectLinks=(root:string,filename:string):void=>{
  try { assertProjectPathHasNoSymlinks(root,filename); } catch { throw new PersonalAssetError(403,'Symlinked project paths are not accessible'); }
};
const revisionOf=(value:unknown):number|undefined=>{
  if(value===undefined)return undefined;
  if(typeof value==='string'&&!/^[1-9]\d*$/.test(value))throw new PersonalAssetError(400,'Invalid revision');
  const revision=typeof value==='number'?value:typeof value==='string'?Number(value):NaN;
  if(!Number.isSafeInteger(revision)||revision<1)throw new PersonalAssetError(400,'Invalid revision');
  return revision;
};

export function registerAssetLibraryRoutes(app:Express,deps:Deps):void {
  const service=deps.service;
  const receive=multer({storage:multer.memoryStorage(),preservePath:true,limits:{fileSize:200*1024*1024,files:1,fields:30,fieldSize:5*1024*1024}}).single('file');
  const upload:RequestHandler=(req,res,next)=>receive(req,res,error=>{
    if(!error){next();return;}
    const tooLarge=(error as {code?:string}).code==='LIMIT_FILE_SIZE';
    res.status(tooLarge?413:400).json({error:{code:'ASSET_LIBRARY_UPLOAD_ERROR',message:tooLarge?'Maximum upload size is 200 MB':'Invalid upload; provide one file'}});
  });
  const authorizeSource=async(req:Request,res:Response,source:PersonalAssetCreate['source'])=>{
    if(!source?.projectId)return true;
    if(typeof source.projectId!=='string')throw new PersonalAssetError(400,'Invalid source project');
    return deps.authorizeProject(req,res,source.projectId,{mode:'read'});
  };
  const enrich=async(id:string,input:PersonalAssetAnalysisRequest)=>{
    try { return await deps.analysis!.enqueue(id,input,'metadata'); }
    catch { return {status:'failed' as const,error:'Asset saved, but analysis could not be scheduled'}; }
  };
  app.get(`${base}/info`,route((_req,res)=>{res.json(assetLibraryInfo(service,deps));}));
  app.get(base,route(async(_req,res)=>{
    // Complete one bounded original indexing pass before returning; close waits for in-flight decoding.
    if(service.imageMetadata)await service.indexImages();
    res.json({assets:await service.list()});
  }));
  app.get(`${base}/catalogue`,route(async(_req,res)=>{if(!deps.catalogue){unavailable(res,'catalogue');return;}res.json(await deps.catalogue.list());}));
  app.post(`${base}/import-templates`,route(async(req,res)=>{
    if(!deps.catalogue){unavailable(res,'catalogue');return;}
    const templates=body(req).templates;
    if(!Array.isArray(templates)||templates.length>1000)throw new PersonalAssetError(400,'Invalid template selection');
    const approved=await deps.catalogue.resolveTemplates(templates);
    res.json({assets:await service.importTemplates(approved)});
  }));
  app.get(`${base}/spaces`,route(async(req,res)=>{res.json(await service.readSpaces(textQuery(req.query.scope,'local')!));}));
  app.post(`${base}/spaces`,route(async(req,res)=>{res.json(await service.patchSpaces(textQuery(req.query.scope,'local')!,body(req) as never));}));
  app.get(`${base}/export`,route(async(req,res)=>{
    const ids=[...new Set(textQuery(req.query.ids,'')!.split(',').filter(Boolean))];
    if(!ids.length||ids.length>500)throw new PersonalAssetError(400,'Select 1–500 assets');
    const all=await service.list(),zip=new JSZip(),visited=new Set<string>();let total=0;
    async function add(id:string,parent:string):Promise<void>{
      if(visited.has(id))return;
      const asset=await service.read(id);if(asset.deletedAt)return;visited.add(id);
      if(asset.kind==='folder'){
        const directory=`${parent}${safeEntry(asset.name)}-${safeEntry(id.slice(0,8))}/`;zip.folder(directory);
        for(const child of all.filter(a=>a.parentId===id))await add(child.id,directory);
      }else{
        const {bytes,version}=await service.content(id);total+=bytes.length;
        if(total>500*1024*1024)throw new PersonalAssetError(400,'Maximum export size is 500 MB');
        zip.file(`${parent}${safeEntry(id.slice(0,8))}-${safeEntry(version.filename)}`,bytes);
      }
    }
    for(const id of ids)await add(id,'');
    res.setHeader('Content-Type','application/zip');res.setHeader('Content-Disposition','attachment; filename="personal-assets.zip"');
    res.send(await zip.generateAsync({type:'nodebuffer',compression:'STORE'}));
  }));
  app.post(base,route(async(req,res)=>{
    const {aiFill,execution,executionRequired,...input}=body(req);
    if(input.captureId!==undefined&&!service.idempotentCreate)throw new PersonalAssetError(503,'Source does not support idempotent capture');
    if(aiFill!==undefined&&typeof aiFill!=='boolean')throw new PersonalAssetError(400,'Invalid aiFill');
    if(aiFill&&!deps.analysis){unavailable(res,'analysis');return;}
    if(!await authorizeSource(req,res,input.source))return;
    const asset=await service.create(input as PersonalAssetCreate);
    res.status(201).json({asset,...(aiFill?{analysis:await enrich(asset.id,{execution,executionRequired})}:{})});
  }));
  app.post(`${base}/upload`,upload,route(async(req,res)=>{
    if(!req.file)throw new PersonalAssetError(400,'Provide a file');
    const fields=body(req),ratingText:unknown=fields.rating;
    if(fields.captureId!==undefined&&!service.idempotentCreate)throw new PersonalAssetError(503,'Source does not support idempotent capture');
    if(ratingText!==undefined&&(typeof ratingText!=='string'||! /^[0-5]$/.test(ratingText)))throw new PersonalAssetError(400,'Rating must be an integer from 0 to 5');
    if(fields.aiFill==='true'&&!deps.analysis){unavailable(res,'analysis');return;}
    const parse=(name:string)=>{try{return fields[name]===undefined?undefined:JSON.parse(fields[name]);}catch{throw new PersonalAssetError(400,`Invalid ${name}`);}};
    const source=parse('source'),tags=parse('tags');
    if(!await authorizeSource(req,res,source))return;
    const filename=safeEntry(Buffer.from(req.file.originalname,'latin1').toString('utf8'));
    const asset=await service.create({
      name:fields.name||filename,kind:fields.kind||inferPersonalAssetKind(filename,req.file.mimetype),description:fields.description,captureId:fields.captureId,
      ...(ratingText===undefined?{}:{rating:Number(ratingText)}),style:fields.style,usage:fields.usage,
      ...(tags===undefined?{}:{tags}),parentId:fields.parentId||null,...(fields.spaceId?{spaceId:fields.spaceId}:{}),...(source===undefined?{}:{source}),
    },{bytes:req.file.buffer,filename,mime:req.file.mimetype});
    let execution:PersonalAssetAnalysisRequest['execution'];
    try{execution=parse('execution');}catch{/* Keep saving separate from optional analysis failure. */}
    res.status(201).json({asset,...(fields.aiFill==='true'?{analysis:await enrich(asset.id,{...(execution?{execution}:{}),executionRequired:fields.executionRequired==='true'})}:{})});
  }));
  app.post(`${base}/batch`,route(async(req,res)=>{
    const {ids,action,patch}=body(req);res.json({assets:await service.batch(ids,action,patch)});
  }));
  app.get(`${base}/:id/metadata.yaml`,route(async(req,res)=>{
    const asset=await service.read(String(req.params.id));res.type('application/yaml').send(`asset_id: ${JSON.stringify(asset.id)}\ntype: ${JSON.stringify(asset.kind)}\nspace_id: ${JSON.stringify(asset.spaceId||'default-project')}\n`+assetMetadataYaml(asset));
  }));
  app.get(`${base}/:id/analysis`,route(async(req,res)=>{
    if(!deps.analysis){unavailable(res,'analysis');return;}await service.read(String(req.params.id));res.json(await deps.analysis.state(String(req.params.id),'metadata'));
  }));
  app.post(`${base}/:id/analysis`,route(async(req,res)=>{
    if(!deps.analysis){unavailable(res,'analysis');return;}await service.read(String(req.params.id));res.status(202).json(await deps.analysis.enqueue(String(req.params.id),body(req),'metadata'));
  }));
  app.get(`${base}/:id/prompt`,route(async(req,res)=>{
    const asset=await service.read(String(req.params.id));
    res.json({... (deps.analysis?await deps.analysis.state(asset.id,'prompt'):{status:'idle'}),prompt:asset.prompt??null,available:Boolean(deps.analysis)});
  }));
  app.post(`${base}/:id/prompt`,route(async(req,res)=>{
    if(!deps.analysis){unavailable(res,'analysis');return;}await service.read(String(req.params.id));res.status(202).json(await deps.analysis.enqueue(String(req.params.id),body(req),'prompt'));
  }));
  app.get(`${base}/:id/versions`,route(async(req,res)=>{res.json({versions:(await service.read(String(req.params.id))).versions});}));
  app.post(`${base}/:id/versions`,upload,route(async(req,res)=>{
    const fields=body(req),id=String(req.params.id),existing=(await service.read(id)).versions.at(-1);
    if(!existing)throw new PersonalAssetError(400,'Folders have no content versions');
    if(!req.file&&typeof fields.content!=='string')throw new PersonalAssetError(400,'Provide file or text content');
    if(!req.file&&Buffer.byteLength(fields.content)>4*1024*1024)throw new PersonalAssetError(400,'Maximum text size is 4 MB');
    if(req.file)safeEntry(Buffer.from(req.file.originalname,'latin1').toString('utf8'));
    const asset=await service.version(id,{bytes:req.file?.buffer??Buffer.from(fields.content),filename:req.file?(fields.name||existing.filename):existing.filename,mime:req.file?.mimetype??existing.mime},revisionOf(fields.revision));
    res.json({asset});
  }));
  app.get(`${base}/:id/content`,route(async(req,res)=>{
    const {bytes:content,version}=await service.content(String(req.params.id),textQuery(req.query.version));const bytes=Buffer.from(content);
    res.setHeader('Content-Type',/^[\w.+-]+\/[\w.+-]+$/.test(version.mime)?version.mime:'application/octet-stream');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src data:");
    res.setHeader('Cache-Control','private, no-cache');
    res.setHeader('Content-Disposition',`${req.query.download==='1'?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(safeEntry(version.filename))}`);
    res.setHeader('Accept-Ranges','bytes');
    if(req.headers.range){
      const range=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range),from=range?.[1],to=range?.[2];
      const start=from?Number(from):Math.max(0,bytes.length-Number(to));
      const end=from?(to?Math.min(Number(to),bytes.length-1):bytes.length-1):bytes.length-1;
      if(!range||(!from&&!to)||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=bytes.length){res.setHeader('Content-Range',`bytes */${bytes.length}`);res.status(416).end();return;}
      res.status(206).setHeader('Content-Range',`bytes ${start}-${end}/${bytes.length}`);res.send(bytes.subarray(start,end+1));return;
    }
    res.send(bytes);
  }));
  app.get(`${base}/:id/uses`,route(async(req,res)=>{
    const uses=await service.uses(String(req.params.id));
    for(const use of uses)if(!await deps.authorizeProject(req,res,use.projectId,{mode:'read'}))return;
    res.json({uses});
  }));
  app.post(`${base}/:id/uses`,route(async(req,res)=>{
    const use=body(req) as PersonalAssetUse;
    if(typeof use.projectId!=='string'||!use.projectId)throw new PersonalAssetError(400,'Invalid use project');
    if(!await deps.authorizeProject(req,res,use.projectId,{mode:'write'}))return;
    // Uses record project paths but never dereference arbitrary filesystem locations.
    projectPath(use.filename);await service.recordUse(String(req.params.id),use);res.json({ok:true});
  }));
  app.get(`${base}/:id`,route(async(req,res)=>{res.json({asset:await service.read(String(req.params.id))});}));
  app.patch(`${base}/:id`,route(async(req,res)=>{res.json({asset:await service.patch(String(req.params.id),body(req))});}));

  app.post('/api/projects/:id/asset-library/save',route(async(req,res)=>{
    const projectId=String(req.params.id),input=body(req) as AssetLibrarySaveRequest;
    if(!await deps.authorizeProject(req,res,projectId,{mode:'read'}))return;
    const filename=projectPath(input.filename),root=deps.registry.resolveProjectRoot(projectId),metadata=deps.registry.get(projectId)?.metadata;
    noProjectLinks(root,filename);
    const resolved=await resolveProjectFilePath(deps.registry.projectsRoot,projectId,filename,metadata);
    if(resolved.size>200*1024*1024)throw new PersonalAssetError(413,'Maximum asset size is 200 MB');
    const file=await readProjectFile(deps.registry.projectsRoot,projectId,filename,metadata);
    const {filename:_filename,...metadataInput}=input;
    const asset=await service.create({...metadataInput,name:input.name||path.posix.basename(filename),kind:input.kind||inferPersonalAssetKind(filename,file.mime),source:{projectId,filename}},
      {bytes:file.buffer,filename:path.posix.basename(filename),mime:file.mime});
    res.status(201).json({asset});
  }));
  app.post('/api/projects/:id/asset-library/import',route(async(req,res)=>{
    const projectId=String(req.params.id),input=body(req) as AssetLibraryImportRequest;
    if(!await deps.authorizeProject(req,res,projectId,{mode:'write'}))return;
    if(typeof input.assetId!=='string')throw new PersonalAssetError(400,'Invalid asset reference');
    const {asset,version,bytes}=await service.content(input.assetId,textQuery(input.versionId));
    const filename=projectPath(input.path??version.filename),root=deps.registry.resolveProjectRoot(projectId);
    noProjectLinks(root,filename);
    let file:Awaited<ReturnType<typeof writeProjectFile>>|undefined;
    try{
      file=await writeProjectFile(deps.registry.projectsRoot,projectId,filename,Buffer.from(bytes),{overwrite:false,preserveBytes:true},deps.registry.get(projectId)?.metadata);
      await service.recordUse(asset.id,{projectId,filename,versionId:version.id,usedAt:Date.now()});
      res.json({asset,version,files:[file]});
    }catch(error){
      const value=error as {code?:string;message?:string;committedPath?:string};
      const published=Boolean(file)||value.committedPath===filename;
      // Publication is never undone destructively when a later receipt step fails.
      res.status(published||value.code==='EEXIST'?409:400).json({error:{code:published?'ASSET_IMPORT_PARTIAL':'ASSET_IMPORT_FAILED',message:value.message??'Asset import failed'},files:file?[file]:[],publishedPaths:published?[filename]:[],attemptedPath:filename});
    }
  }));
}
