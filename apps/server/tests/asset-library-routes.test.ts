import {afterEach, expect, it} from 'vitest';
import {mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync, existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import type {AddressInfo} from 'node:net';
import JSZip from 'jszip';
import type {PersonalAsset} from '@bezier/contracts';
import {createCanvasServer, type CanvasServerOptions} from '../src/server.js';
import {createLocalAssetLibrary} from '../src/asset-library/service.js';
import {projectFileWriteTestHooks} from '../src/projects.js';

const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{projectFileWriteTestHooks.afterCommit=null;for(const close of cleanups.splice(0).reverse())await close();});
async function fixture(options:Partial<CanvasServerOptions>={},root=mkdtempSync(path.join(os.tmpdir(),'canvas-library-http-'))){
 const api=createCanvasServer({...options,dataRoot:root});await api.ready;
 const listener=api.app.listen(0,'127.0.0.1');await once(listener,'listening');
 const url=`http://127.0.0.1:${(listener.address() as AddressInfo).port}`;
 let closed=false;
 const close=async()=>{if(closed)return;closed=true;await new Promise<void>((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));await api.close();};
 cleanups.push(async()=>{await close();if(path.dirname(root)===os.tmpdir()&&path.basename(root).startsWith('canvas-library-http-'))rmSync(root,{recursive:true,force:true});});
 const request=(endpoint:string,method='GET',value?:unknown)=>fetch(url+endpoint,{method,...(value===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})});
 return {api,url,root,close,request};
}
async function create(f:Awaited<ReturnType<typeof fixture>>,input:Record<string,unknown>={}){const r=await f.request('/api/asset-library','POST',{name:'Note',kind:'text',content:'original',...input});expect(r.status).toBe(201);return (await r.json() as {asset:PersonalAsset}).asset;}

it('creates, renames and removes spaces through HTTP while moving cross-space folder trees atomically',async()=>{
 const f=await fixture(),endpoint='/api/asset-library/spaces?scope=local';
 expect((await f.request(endpoint,'POST',{upsert:['removed','target','other'].map(id=>({id,name:id,createdAt:1})),remove:[]})).status).toBe(200);
 const renamed=await f.request(endpoint,'POST',{upsert:[{id:'removed',name:'Renamed',createdAt:1}],remove:[]});expect(renamed.status).toBe(200);
 expect(await renamed.json()).toMatchObject({folders:[{id:'removed',name:'Renamed'},{id:'target'},{id:'other'}],initialized:true});
 const parent=await create(f,{name:'Outer',kind:'folder',spaceId:'other'}),folder=await create(f,{name:'Folder',kind:'folder',spaceId:'removed',parentId:parent.id}),child=await create(f,{name:'Cross space',spaceId:'other',parentId:folder.id});
 const result=await f.request(endpoint,'POST',{upsert:[],remove:['removed'],targetSpaceId:'target'});expect(result.status).toBe(200);
 expect(await result.json()).toMatchObject({folders:[{id:'target'},{id:'other'}]});
 expect(await(await f.request(`/api/asset-library/${folder.id}`)).json()).toMatchObject({asset:{spaceId:'target',parentId:null,revision:2}});
 expect(await(await f.request(`/api/asset-library/${child.id}`)).json()).toMatchObject({asset:{spaceId:'target',parentId:folder.id,revision:2}});
 expect(await(await f.request(`/api/asset-library/${child.id}/content`)).text()).toBe('original');
 expect((await f.request(`/api/asset-library/${child.id}`,'PATCH',{name:'Stale',revision:1})).status).toBe(409);
 for(const input of [{upsert:[],remove:['default-project']},{upsert:[],remove:['target'],targetSpaceId:'missing'},{upsert:[],remove:['target','other'],targetSpaceId:'other'}])expect((await f.request(endpoint,'POST',input)).status).toBe(400);
 expect(await(await f.request(endpoint)).json()).toMatchObject({folders:[{id:'target'},{id:'other'}]});
});
it('preserves captured upload retries after default space moves and rejects late writes after reopen',async()=>{
 const f=await fixture();await f.request('/api/asset-library/spaces','POST',{upsert:[{id:'removed',name:'Removed',createdAt:1}],remove:[]});
 const upload=async(url:string,captureId='space-capture')=>{const form=new FormData();form.set('file',new Blob(['captured']),'capture.txt');form.set('spaceId','removed');form.set('captureId',captureId);return fetch(url+'/api/asset-library/upload',{method:'POST',body:form});};
 const captured=await upload(f.url);expect(captured.status).toBe(201);const asset=(await captured.json() as {asset:PersonalAsset}).asset;
 expect((await f.request('/api/asset-library/spaces','POST',{upsert:[],remove:['removed']})).status).toBe(200);
 expect(await(await upload(f.url)).json()).toMatchObject({asset:{id:asset.id,spaceId:'default-project'}});
 expect((await upload(f.url,'new-operation')).status).toBe(409);
 expect((await f.request('/api/asset-library','POST',{name:'Late',kind:'text',spaceId:'removed'})).status).toBe(409);
 expect((await f.request(`/api/asset-library/${asset.id}`,'PATCH',{spaceId:'removed'})).status).toBe(409);
 expect((await f.request('/api/asset-library/batch','POST',{ids:[asset.id],action:'copy',patch:{spaceId:'removed'}})).status).toBe(409);
 await f.close();const reopened=await fixture({},f.root);expect((await upload(reopened.url,'new-after-reopen')).status).toBe(409);
 expect(await(await upload(reopened.url)).json()).toMatchObject({asset:{id:asset.id,spaceId:'default-project'}});
});
it('permanently deletes explicitly confirmed space content, including cross-space children and captured receipts',async()=>{
 const f=await fixture();await f.request('/api/asset-library/spaces','POST',{upsert:['removed','other'].map(id=>({id,name:id,createdAt:1})),remove:[]});
 const folder=await create(f,{kind:'folder',spaceId:'removed'}),child=await create(f,{name:'Child',spaceId:'other',parentId:folder.id,captureId:'destructive-capture'}),keep=await create(f,{name:'Keep',spaceId:'other'});
 const project=f.api.registry.create({name:'Use'});expect((await f.request(`/api/asset-library/${child.id}/uses`,'POST',{projectId:project.id,filename:'child.md',versionId:child.versions[0]!.id,usedAt:0})).status).toBe(200);
 expect((await f.request('/api/asset-library/spaces','POST',{upsert:[],remove:['removed'],removeContents:true})).status).toBe(200);
 expect(await(await f.request('/api/asset-library')).json()).toEqual({assets:[keep]});expect((await f.request(`/api/asset-library/${child.id}/content`)).status).toBe(404);expect((await f.request(`/api/asset-library/${child.id}/uses`)).status).toBe(404);
 expect((await f.request('/api/asset-library','POST',{name:'Child',kind:'text',content:'original',spaceId:'other',parentId:folder.id,captureId:'destructive-capture'})).status).toBe(409);
 expect(await(await f.request(`/api/asset-library/${keep.id}/content`)).text()).toBe('original');
});
it('serves the full local library and accurately separates optional hooks from core',async()=>{
 const f=await fixture();const info=await(await f.request('/api/asset-library/info')).json();
 expect(info).toMatchObject({source:{id:'builtin-local',kind:'builtin'},capabilities:{upload:true,versions:true,imageMetadata:true,idempotentCreate:true,analysis:false,catalogue:false},deletion:'permanent'});
 const a=await create(f);expect(await(await f.request('/api/asset-library')).json()).toMatchObject({assets:[{id:a.id}]});
 for(const [endpoint,method] of [[`/${a.id}/analysis`,'GET'],[`/${a.id}/analysis`,'POST'],[`/${a.id}/prompt`,'POST'],['/import-templates','POST'],['/catalogue','GET']]){
   const response=await f.request('/api/asset-library'+endpoint,method,method==='POST'?{}:undefined);expect(response.status).toBe(503);expect(await response.json()).toMatchObject({error:{code:'ASSET_LIBRARY_CAPABILITY_UNAVAILABLE'}});
 }
 expect(await(await f.request(`/api/asset-library/${a.id}/prompt`)).json()).toMatchObject({prompt:null,available:false});
 const denied=await f.request('/api/asset-library','POST',{name:'No fake AI',kind:'text',aiFill:true});expect(denied.status).toBe(503);expect(await f.api.assetLibrary.list()).toHaveLength(1);
});
it('keeps exact upload bytes, immutable versions, MIME sandbox, ranges and revision conflicts',async()=>{
 const f=await fixture(),bytes=Buffer.from([0,255,128,13,10,42]);const form=new FormData();form.set('file',new Blob([bytes],{type:'application/octet-stream'}),'original.bin');form.set('name','Display');form.set('rating','4');
 const upload=await fetch(f.url+'/api/asset-library/upload',{method:'POST',body:form});expect(upload.status).toBe(201);const a=(await upload.json() as {asset:PersonalAsset}).asset;
 expect(a.versions[0]!.filename).toBe('original.bin');expect(a.rating).toBe(4);
 const content=await f.request(`/api/asset-library/${a.id}/content`);expect(Buffer.from(await content.arrayBuffer())).toEqual(bytes);expect(content.headers.get('content-security-policy')).toContain('sandbox');expect(content.headers.get('x-content-type-options')).toBe('nosniff');
 const range=await fetch(`${f.url}/api/asset-library/${a.id}/content`,{headers:{Range:'bytes=1-3'}});expect(range.status).toBe(206);expect(Buffer.from(await range.arrayBuffer())).toEqual(bytes.subarray(1,4));
 for(const value of ['bytes=20-30','bytes=-0','bytes=3-1','bytes=0-1,4-5','garbage'])expect((await fetch(`${f.url}/api/asset-library/${a.id}/content`,{headers:{Range:value}})).status).toBe(416);
 expect((await f.request(`/api/asset-library/${a.id}/versions`,'POST',{content:'updated',revision:a.revision})).status).toBe(200);
 expect((await f.request(`/api/asset-library/${a.id}`,'PATCH',{name:'stale',revision:a.revision})).status).toBe(409);
 expect((await f.request(`/api/asset-library/${a.id}/versions`,'POST',{content:'stale',revision:a.revision})).status).toBe(409);
 expect(Buffer.from(await(await f.request(`/api/asset-library/${a.id}/content?version=${a.versions[0]!.id}`)).arrayBuffer())).toEqual(bytes);
 expect((await(await f.request(`/api/asset-library/${a.id}/versions`)).json() as {versions:unknown[]}).versions).toHaveLength(2);
});
it('stores metadata, spaces, manual prompts and permanent batch semantics',async()=>{
 const f=await fixture(),folder=await create(f,{name:'Folder',kind:'folder'}),a=await create(f,{parentId:folder.id});
 expect((await f.request('/api/asset-library/spaces?scope=local','POST',{upsert:[{id:'brand',name:'Brand',createdAt:1}],remove:[]})).status).toBe(200);
 expect(await(await f.request('/api/asset-library/spaces?scope=other')).json()).toEqual({folders:[],initialized:false});
 expect((await f.request(`/api/asset-library/${a.id}`,'PATCH',{description:'Description',style:'minimal',usage:'demo',tags:['one'],prompt:{text:'Manual prompt',versionId:a.versions[0]!.id,generatedAt:1}})).status).toBe(200);
 expect(await(await f.request(`/api/asset-library/${a.id}/metadata.yaml`)).text()).toContain('Description');
 const copy=await f.request('/api/asset-library/batch','POST',{ids:[folder.id,a.id],action:'copy'});expect((await copy.json() as {assets:PersonalAsset[]}).assets).toHaveLength(2);
 const cycle=await f.request(`/api/asset-library/${folder.id}`,'PATCH',{parentId:folder.id});expect(cycle.status).toBe(400);
 expect((await f.request('/api/asset-library/batch','POST',{ids:[folder.id],action:'trash'})).status).toBe(200);expect((await f.request(`/api/asset-library/${a.id}/content`)).status).toBe(404);
});
it('exports folders as real ZIP bytes and blocks unsafe multipart paths before creating anything',async()=>{
 const f=await fixture(),folder=await create(f,{name:'Archive',kind:'folder'}),a=await create(f,{parentId:folder.id,content:'zip bytes'});
 const zipped=await f.request(`/api/asset-library/export?ids=${folder.id}`);expect(zipped.status).toBe(200);const zip=await JSZip.loadAsync(await zipped.arrayBuffer());
 const files=Object.values(zip.files).filter(entry=>!entry.dir);expect(files).toHaveLength(1);expect(await files[0]!.async('string')).toBe('zip bytes');
 const form=new FormData();form.set('file',new Blob(['bad']),'../bad.txt');const bad=await fetch(f.url+'/api/asset-library/upload',{method:'POST',body:form});expect(bad.status).toBe(400);
 expect((await f.api.assetLibrary.list()).map(a=>a.id).sort()).toEqual([folder.id,a.id].sort());
});
it('saves and imports project bytes through confined file publication and records authorized uses',async()=>{
 const f=await fixture(),project=f.api.registry.create({name:'Project'}),root=f.api.registry.resolveProjectRoot(project.id);
 const original='<script src="https://unpkg.com/motion@1/dist/motion.js"></script><script>Motion.useScroll()</script>';
 writeFileSync(path.join(root,'input.html'),original);
 const saved=await f.request(`/api/projects/${project.id}/asset-library/save`,'POST',{filename:'input.html',name:'Reusable'});expect(saved.status).toBe(201);const a=(await saved.json() as {asset:PersonalAsset}).asset;
 const imported=await f.request(`/api/projects/${project.id}/asset-library/import`,'POST',{assetId:a.id,path:'copy.html'});expect(imported.status).toBe(200);expect(readFileSync(path.join(root,'copy.html'),'utf8')).toBe(original);
 const conflict=await f.request(`/api/projects/${project.id}/asset-library/import`,'POST',{assetId:a.id,path:'copy.html'});expect(conflict.status).toBe(409);expect(readFileSync(path.join(root,'copy.html'),'utf8')).toBe(original);
 const uses=await(await f.request(`/api/asset-library/${a.id}/uses`)).json();expect(uses).toMatchObject({uses:[{projectId:project.id,filename:'copy.html',versionId:a.versions[0]!.id}]});
 const traversal=await f.request(`/api/projects/${project.id}/asset-library/import`,'POST',{assetId:a.id,path:'../escape.html'});expect(traversal.status).toBe(400);
 symlinkSync(f.root,path.join(root,'linked'));expect((await f.request(`/api/projects/${project.id}/asset-library/save`,'POST',{filename:'linked/workspace.sqlite'})).status).toBe(403);
 expect((await f.request(`/api/projects/${project.id}/asset-library/import`,'POST',{assetId:a.id,path:'linked/escape.html'})).status).toBe(403);expect(existsSync(path.join(f.root,'escape.html'))).toBe(false);
});
it('does not bypass host/project policy for uses, source attribution or project imports',async()=>{
 const f=await fixture({authorizeProject:(_req,res)=>{res.status(403).json({error:{code:'DENIED'}});return false;}}),a=await create(f),project=f.api.registry.create({name:'Private'});
 expect((await f.request(`/api/asset-library/${a.id}/uses`,'POST',{projectId:project.id,filename:'x.md',versionId:a.versions[0]!.id,usedAt:1})).status).toBe(403);
 expect((await f.request('/api/asset-library','POST',{name:'Spoof',kind:'text',source:{projectId:project.id}})).status).toBe(403);
 expect((await f.request(`/api/projects/${project.id}/asset-library/import`,'POST',{assetId:a.id})).status).toBe(403);
 const blocked=await fetch(f.url+'/api/asset-library',{method:'POST',headers:{Origin:'https://attacker.example','Content-Type':'application/json'},body:'{}'});expect(blocked.status).toBe(403);
});
it('persists complete library across reopen and isolates explicit data roots',async()=>{
 const f=await fixture(),a=await create(f,{content:'persisted'});await f.close();
 const reopened=await fixture({},f.root),isolated=await fixture();expect(await(await reopened.request(`/api/asset-library/${a.id}/content`)).text()).toBe('persisted');expect(await(await isolated.request('/api/asset-library')).json()).toEqual({assets:[]});
});
it('durably deduplicates captured multipart retries and conflicts on changed bytes or metadata',async()=>{
 const f=await fixture();const upload=async(url:string,text='capture',name='Capture')=>{const form=new FormData();form.set('file',new Blob([text]),'capture.txt');form.set('name',name);form.set('captureId','resource:stable-1');return fetch(url+'/api/asset-library/upload',{method:'POST',body:form});};
 const first=await upload(f.url);expect(first.status).toBe(201);const a=(await first.json() as {asset:PersonalAsset}).asset;
 const second=await upload(f.url);expect((await second.json() as {asset:PersonalAsset}).asset.id).toBe(a.id);expect(await f.api.assetLibrary.list()).toHaveLength(1);
 expect((await upload(f.url,'changed')).status).toBe(409);expect((await upload(f.url,'capture','Changed')).status).toBe(409);
 await f.close();const reopened=await fixture({},f.root);expect((await(await upload(reopened.url)).json() as {asset:PersonalAsset}).asset.id).toBe(a.id);
});
it('uses a replacement full-library adapter and reports import receipt failures without destructive rollback',async()=>{
 const sourceRoot=mkdtempSync(path.join(os.tmpdir(),'canvas-library-http-'));const local=createLocalAssetLibrary(sourceRoot);cleanups.push(async()=>rmSync(sourceRoot,{recursive:true,force:true}));
 const f=await fixture({assetLibrary:{adapter:{...local,source:{id:'custom',name:'Configured source',kind:'external'},recordUse(){throw new Error('Receipt unavailable');}}}});
 expect(await(await f.request('/api/asset-library/info')).json()).toMatchObject({source:{id:'custom',kind:'external'}});
 const a=await create(f),project=f.api.registry.create({name:'P'});const result=await f.request(`/api/projects/${project.id}/asset-library/import`,'POST',{assetId:a.id,path:'kept.md'});
 expect(result.status).toBe(409);expect(await result.json()).toMatchObject({error:{code:'ASSET_IMPORT_PARTIAL'},files:[{name:'kept.md'}]});expect(readFileSync(path.join(f.api.registry.resolveProjectRoot(project.id),'kept.md'),'utf8')).toBe('original');
});
it('reports bytes already published when the project writer fails after commit',async()=>{
 const f=await fixture(),a=await create(f),project=f.api.registry.create({name:'P'});
 projectFileWriteTestHooks.afterCommit=()=>{throw new Error('post-write failure');};
 const result=await f.request(`/api/projects/${project.id}/asset-library/import`,'POST',{assetId:a.id,path:'published.md'});
 expect(result.status).toBe(409);expect(await result.json()).toMatchObject({error:{code:'ASSET_IMPORT_PARTIAL'},publishedPaths:['published.md']});
 expect(readFileSync(path.join(f.api.registry.resolveProjectRoot(project.id),'published.md'),'utf8')).toBe('original');
});
it('keeps the legacy external list/import adapter compatible and reports post-commit partial writes',async()=>{
 const f=await fixture({assets:{list:async()=>({resources:[{id:'external-resource'}]}),import:async()=>({files:[{path:'external.txt',content:Buffer.from('external')}]})}}),project=f.api.registry.create({name:'V1'});
 expect(await(await f.request(`/api/projects/${project.id}/external-assets`)).json()).toEqual({resources:[{id:'external-resource'}]});
 const sources=await(await f.request(`/api/projects/${project.id}/asset-sources`)).json() as {sources:Array<{id:string;capabilities:unknown}>};
 expect(sources.sources.map(source=>source.id)).toEqual(['project','asset-library','external']);
 projectFileWriteTestHooks.afterCommit=()=>{throw new Error('post-write failure');};
 const response=await f.request(`/api/projects/${project.id}/external-assets/import`,'POST',{});expect(response.status).toBe(409);expect(await response.json()).toMatchObject({error:{code:'ASSET_IMPORT_PARTIAL'},publishedPaths:['external.txt']});
 expect(readFileSync(path.join(f.api.registry.resolveProjectRoot(project.id),'external.txt'),'utf8')).toBe('external');
});
it('only imports approved catalogue selections and calls real optional analysis hooks',async()=>{
 const template={name:'Approved',kind:'text' as const,content:'prompt',source:{template:{id:'approved',type:'Slides' as const,referencePath:'design-templates/approved/TEMPLATE.md',posterSrc:null,previewSrc:null,previewVideo:null}}};
 const f=await fixture({assetLibrary:{catalogue:{list:()=>({templates:[template]}),resolveTemplates:()=>[template]},analysis:{state:()=>({status:'queued'}),enqueue:()=>({status:'queued'})}}});
 expect(await(await f.request('/api/asset-library/info')).json()).toMatchObject({capabilities:{catalogue:true,analysis:true}});
 const imported=await f.request('/api/asset-library/import-templates','POST',{templates:[template]});expect(imported.status).toBe(200);const a=(await imported.json() as {assets:PersonalAsset[]}).assets[0]!;
 expect((await f.request(`/api/asset-library/${a.id}/analysis`,'POST',{})).status).toBe(202);expect(await(await f.request(`/api/asset-library/${a.id}/analysis`)).json()).toEqual({status:'queued'});
});
