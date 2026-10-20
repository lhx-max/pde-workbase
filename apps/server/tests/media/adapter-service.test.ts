import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';import sharp from 'sharp';
import {Database} from '../../src/storage/database.js';import {writeProjectFile} from '../../src/projects.js';import {createProjectRegistry} from '../../src/storage/project-registry.js';import {CanvasStateService} from '../../src/canvas/state.js';
import {MediaAdapterService,type MediaAdapter,type MediaCatalog} from '../../src/media/adapter-service.js';
const catalog:MediaCatalog={providers:[{id:'test',integrated:true,capabilities:['image']}],image:[{id:'test-image',label:'Test',provider:'test',caps:['t2i']}],video:[],audio:{},aspects:['1:1'],videoLengthsSec:[],audioDurationsSec:[]};
function fixture(adapter?:MediaAdapter){const root=mkdtempSync(path.join(os.tmpdir(),'canvas-media-adapter-'));const registry=createProjectRegistry(root);const project=registry.create({name:'Media'});const db=new Database(path.join(root,'workspace.sqlite'));db.exec('CREATE TABLE projects(id TEXT PRIMARY KEY)');db.prepare('INSERT INTO projects(id) VALUES(?)').run(project.id);const canvas=new CanvasStateService(id=>registry.resolveProjectRoot(id));const media=new MediaAdapterService(db,registry,canvas,adapter);return {root,registry,project,db,canvas,media,async close(){await media.close();db.close();rmSync(root,{recursive:true,force:true});}};}
it('does not accept media generation without an execution adapter',async()=>{const f=fixture();try{await expect(f.media.submit(f.project.id,{surface:'image',model:'test-image'})).rejects.toMatchObject({status:503,code:'MEDIA_ADAPTER_UNAVAILABLE'});}finally{await f.close();}});
it('reuses request identity, persists genuine image bytes and backend delivery after page closure',async()=>{
 let calls=0;const image=await sharp({create:{width:8,height:4,channels:3,background:'#e44'}}).png().toBuffer();
 const adapter:MediaAdapter={catalog:async()=>catalog,config:async()=>({providers:{test:{configured:true}}}),generate:async input=>{calls++;expect(input.inputs).toEqual([{path:'reference.png',content:image,mime:'image/png'}]);input.onProgress('provider accepted');return {path:String(input.request.output),content:image,mime:'image/png'};}};
 const f=fixture(adapter);try{
  await writeProjectFile(f.registry.projectsRoot,f.project.id,'reference.png',image,{},f.project.metadata);
  await f.canvas.patch(f.project.id,{workbenchImages:[{id:'image',status:'generating'}]});
  const request={surface:'image',model:'test-image',prompt:'red',image:'reference.png',output:'assets/image.png',clientRequestId:randomUUID(),canvasDelivery:{nodeId:'image',kind:'image',basePath:'',baseVersion:'',fileUrl:`/api/projects/${f.project.id}/files/assets/image.png`}};
  const first=await f.media.submit(f.project.id,request);const second=await f.media.submit(f.project.id,request);expect(first.taskId).toBe(second.taskId);expect(second).toMatchObject({reused:true});
  expect(await f.media.wait(first.taskId,new AbortController().signal)).toMatchObject({status:'done',file:{name:'assets/image.png'}});
  await f.media.delivery.reconcile();expect(calls).toBe(1);expect(readFileSync(path.join(f.registry.resolveProjectRoot(f.project.id),'assets/image.png'))).toEqual(image);
  expect((await f.canvas.read(f.project.id)).state.workbenchImages).toMatchObject([{id:'image',path:'assets/image.png',naturalWidth:8,naturalHeight:4}]);
  await expect(f.media.submit(f.project.id,{...request,prompt:'changed'})).rejects.toThrow('请求');
 }finally{await f.close();}
});
it('cancels provider work without silently publishing and retains its terminal receipt',async()=>{
 const adapter:MediaAdapter={catalog:async()=>catalog,config:async()=>({providers:{}}),generate:input=>new Promise((_resolve,reject)=>input.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}))};
 const f=fixture(adapter);try{const task=await f.media.submit(f.project.id,{surface:'image',model:'test-image',prompt:'pending',clientRequestId:randomUUID()});expect(await f.media.cancel(task.taskId)).toMatchObject({status:'interrupted',error:{code:'CANCELLED'}});expect(f.media.list(f.project.id,true)).toHaveLength(1);}finally{await f.close();}
});
