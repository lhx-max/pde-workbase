import {expect,it} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import type {JsonStatePort} from '@ks-designai/app-cloud-state';
import {Database} from '../../src/storage/database.js';
import {createProjectRegistry} from '../../src/storage/project-registry.js';
import {CanvasStateService} from '../../src/canvas/state.js';
import {MediaAdapterService,type MediaAdapter,type MediaCatalog} from '../../src/media/adapter-service.js';
import {MEDIA_TASK_JOURNAL_SLOT} from '../../src/media/cloud-task-journal.js';

const catalog:MediaCatalog={providers:[{id:'test',integrated:true}],image:[{id:'test-image',label:'Test',provider:'test',caps:['t2i']}],video:[],audio:{},aspects:['1:1'],videoLengthsSec:[],audioDurationsSec:[]};

/** Shared durable fake of the cloud JSON state port: write() queues, flush() commits. */
class FakeJsonState implements JsonStatePort{
 private committed=new Map<string,unknown>();
 private queued:Array<()=>void>=[];
 flushError:Error|null=null;
 writeError:Error|null=null;
 readonly ready=Promise.resolve();
 read(key:string):unknown|undefined{return this.committed.get(key);}
 write(key:string,value:unknown):void{if(this.writeError)throw this.writeError;this.queued.push(()=>this.committed.set(key,structuredClone(value)));}
 async flush():Promise<void>{if(this.flushError)throw this.flushError;for(const apply of this.queued.splice(0))apply();}
 seed(key:string,value:unknown):void{this.committed.set(key,structuredClone(value));}
 snapshot():unknown{return this.committed.get(MEDIA_TASK_JOURNAL_SLOT);}
}

/** Each call is a backend boot: fresh in-memory database, same durable store. */
function fixture(root:string,state:FakeJsonState,adapter?:MediaAdapter){
 const registry=createProjectRegistry(root);
 const db=new Database(':memory:');
 db.exec('CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY)');
 const canvas=new CanvasStateService(id=>registry.resolveProjectRoot(id));
 const media=new MediaAdapterService(db,registry,canvas,adapter,undefined,{state});let closed=false;
 return {registry,db,canvas,media,async close(){if(closed)return;closed=true;await media.close().catch(()=>{});db.close();}};
}

async function until(check:()=>boolean,message:string){
 for(let i=0;i<400;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,5));}
 throw new Error(`timeout waiting for ${message}`);
}

const png=async()=>await sharp({create:{width:8,height:4,channels:3,background:'#e44'}}).png().toBuffer();
const root=()=>mkdtempSync(path.join(os.tmpdir(),'media-cloud-journal-'));

it('restores a completed task, its file record and delivery receipt, and never dispatches the same request twice',async()=>{
 const state=new FakeJsonState();let calls=0;const image=await png();
 const adapter:MediaAdapter={catalog:async()=>catalog,config:async()=>({providers:{test:{configured:true}}}),generate:async input=>{calls++;return {path:String(input.request.output),content:image,mime:'image/png'};}};
 const dir=root();const a=fixture(dir,state,adapter);
 try{
  const project=a.registry.create({name:'Media'});
  await a.media.ready();
  await a.canvas.patch(project.id,{workbenchImages:[{id:'img',status:'generating'}]});
  const request={surface:'image',model:'test-image',prompt:'red',output:'assets/image.png',clientRequestId:randomUUID(),
   canvasDelivery:{nodeId:'img',kind:'image',basePath:'',baseVersion:'',fileUrl:`/api/projects/${project.id}/files/assets/image.png`}};
  const first=await a.media.submit(project.id,request);
  expect(await a.media.wait(first.taskId,new AbortController().signal)).toMatchObject({status:'done',file:{name:'assets/image.png'}});
  expect(calls).toBe(1);
  await a.close();
  const b=fixture(dir,state,adapter);
  try{
   await b.media.ready();
   const restored=b.media.get(first.taskId);
   expect(restored).toMatchObject({status:'done',file:{name:'assets/image.png'}});
   expect(b.media.snapshot(restored!)).toMatchObject({canvasDelivery:{status:'delivered'}});
   expect(readFileSync(path.join(b.registry.resolveProjectRoot(project.id),'assets/image.png'))).toEqual(image);
   const again=await b.media.submit(project.id,request);
   expect(again).toMatchObject({taskId:first.taskId,reused:true});
   expect(calls).toBe(1);
   await expect(b.media.submit(project.id,{...request,prompt:'changed'})).rejects.toThrow('请求');
   expect(calls).toBe(1);
  }finally{await b.close();}
 }finally{await a.close();rmSync(dir,{recursive:true,force:true});}
});

it('marks a provider-uncertain running task interrupted after restart and never resubmits it',async()=>{
 const state=new FakeJsonState();let aCalls=0,bCalls=0;
 const blocked:MediaAdapter={catalog:async()=>catalog,config:async()=>({providers:{}}),generate:input=>{aCalls++;return new Promise((_resolve,reject)=>input.signal.addEventListener('abort',()=>reject(new Error('stopped')),{once:true}));}};
 const counting:MediaAdapter={catalog:async()=>catalog,config:async()=>({providers:{}}),generate:async()=>{bCalls++;throw new Error('provider must not be dispatched');}};
 const dir=root();const a=fixture(dir,state,blocked);
 try{
  const project=a.registry.create({name:'Media'});
  await a.media.ready();
  const request={surface:'image',model:'test-image',prompt:'hold',clientRequestId:randomUUID()};
  const task=await a.media.submit(project.id,request);
  await until(()=>aCalls===1,'provider dispatch');
  expect(a.media.get(task.taskId)?.status).toBe('running');
  const b=fixture(dir,state,counting);
  try{
   await b.media.ready();
   expect(bCalls).toBe(0);
   expect(b.media.get(task.taskId)).toMatchObject({status:'interrupted',error:{code:'DAEMON_RESTART'}});
   const same=await b.media.submit(project.id,request);
   expect(same).toMatchObject({taskId:task.taskId,reused:true});
   expect(bCalls).toBe(0);
  }finally{await b.close();}
 }finally{await a.close();rmSync(dir,{recursive:true,force:true});}
});

it('keeps a cancellation durable across restart and still blocks replay of the same request',async()=>{
 const state=new FakeJsonState();let calls=0;
 const blocked:MediaAdapter={catalog:async()=>catalog,config:async()=>({providers:{}}),generate:input=>{calls++;return new Promise((_resolve,reject)=>input.signal.addEventListener('abort',()=>reject(new Error('stopped')),{once:true}));}};
 const dir=root();const a=fixture(dir,state,blocked);
 try{
  const project=a.registry.create({name:'Media'});
  await a.media.ready();
  const request={surface:'image',model:'test-image',prompt:'stop',clientRequestId:randomUUID()};
  const task=await a.media.submit(project.id,request);
  await until(()=>calls===1,'provider dispatch');
  expect(await a.media.cancel(task.taskId)).toMatchObject({status:'interrupted',error:{code:'CANCELLED'}});
  await a.close();
  const b=fixture(dir,state,blocked);
  try{
   await b.media.ready();
   expect(b.media.get(task.taskId)).toMatchObject({status:'interrupted',error:{code:'CANCELLED'}});
   const replay=await b.media.submit(project.id,request);
   expect(replay).toMatchObject({taskId:task.taskId,reused:true});
   expect(calls).toBe(1);
  }finally{await b.close();}
 }finally{await a.close();rmSync(dir,{recursive:true,force:true});}
});

it('fails closed on a corrupt snapshot and never reads pre-existing local business rows',async()=>{
 const state=new FakeJsonState();let calls=0;
 state.seed(MEDIA_TASK_JOURNAL_SLOT,{version:1,projects:['p'],tasks:[{id:'t1',projectId:'p',status:'bogus',progress:[],startedAt:1,createdAt:1,updatedAt:1}],requests:[],adapterRequests:[],deliveries:[]});
 const adapter:MediaAdapter={catalog:async()=>catalog,config:async()=>({providers:{}}),generate:async()=>{calls++;throw new Error('provider must not be dispatched');}};
 const dir=root();const a=fixture(dir,state,adapter);
 try{
  const project=a.registry.create({name:'Media'});
  a.db.prepare('INSERT INTO projects(id) VALUES(?)').run(project.id);
  a.db.prepare(`INSERT INTO media_tasks(id,project_id,status,progress_json,started_at,created_at,updated_at) VALUES('stale','${project.id}','done','[]',1,1,1)`).run();
  await expect(a.media.ready()).rejects.toThrow(/corrupt/);
  expect(()=>a.media.get('stale')).toThrow(/corrupt/);
  expect(a.db.prepare('SELECT count(*) AS n FROM media_tasks').get()).toEqual({n:0});
  await expect(a.media.submit(project.id,{surface:'image',model:'test-image',clientRequestId:randomUUID()})).rejects.toThrow(/corrupt/);
  expect(calls).toBe(0);
 }finally{await a.close();rmSync(dir,{recursive:true,force:true});}
});

it('fails closed when the snapshot references rows that are not part of it',async()=>{
 const state=new FakeJsonState();
 state.seed(MEDIA_TASK_JOURNAL_SLOT,{version:1,projects:['p'],tasks:[],requests:[],adapterRequests:[],deliveries:[{taskId:'missing',projectId:'p',target:{nodeId:'n',kind:'image',basePath:'',baseVersion:'',fileUrl:'/api/projects/p/files/x.png'},status:'pending',error:null}]});
 const dir=root();const a=fixture(dir,state);
 try{
  a.registry.create({name:'Media'});
  await expect(a.media.ready()).rejects.toThrow();
 }finally{await a.close();rmSync(dir,{recursive:true,force:true});}
});

it('never dispatches the provider when the journal cannot be flushed, and stays poisoned',async()=>{
 const state=new FakeJsonState();let calls=0;const image=await png();
 const adapter:MediaAdapter={catalog:async()=>catalog,config:async()=>({providers:{}}),generate:async input=>{calls++;return {path:String(input.request.output),content:image,mime:'image/png'};}};
 const dir=root();const a=fixture(dir,state,adapter);
 try{
  const project=a.registry.create({name:'Media'});
  await a.media.ready();
  state.flushError=new Error('state backend unavailable');
  await expect(a.media.submit(project.id,{surface:'image',model:'test-image',prompt:'x',clientRequestId:randomUUID()})).rejects.toThrow('state backend unavailable');
  expect(calls).toBe(0);
  expect((state.snapshot() as {tasks:unknown[]}|undefined)?.tasks).toEqual([]);
  state.flushError=null;
  await expect(a.media.submit(project.id,{surface:'image',model:'test-image',prompt:'x',clientRequestId:randomUUID()})).rejects.toThrow('state backend unavailable');
  await expect(a.media.cancel('any')).rejects.toThrow('state backend unavailable');
  expect(calls).toBe(0);
 }finally{await a.close();rmSync(dir,{recursive:true,force:true});}
});

it('rejects credential-shaped request fields before dispatch and persists only whitelisted fields',async()=>{
 const state=new FakeJsonState();let calls=0;const image=await png();
 const adapter:MediaAdapter={catalog:async()=>catalog,config:async()=>({providers:{}}),generate:async input=>{calls++;return {path:String(input.request.output),content:image,mime:'image/png'};}};
 const dir=root();const a=fixture(dir,state,adapter);
 try{
  const project=a.registry.create({name:'Media'});
  await a.media.ready();
  await expect(a.media.submit(project.id,{surface:'image',model:'test-image',apiToken:'sk-live-secret'})).rejects.toThrow(/cannot be persisted/);
  await expect(a.media.submit(project.id,{surface:'image',model:'test-image',headers:{authorization:'Bearer sk-live-secret'}})).rejects.toThrow(/cannot be persisted/);
  expect(calls).toBe(0);
  const accepted=await a.media.submit(project.id,{surface:'image',model:'test-image',prompt:'x',customLabel:'drop-me',clientRequestId:randomUUID()});
  expect(await a.media.wait(accepted.taskId,new AbortController().signal)).toMatchObject({status:'done'});
  const stored=state.snapshot() as {version:number;adapterRequests:Array<{taskId:string;request:Record<string,unknown>}>};
  expect(stored.version).toBe(1);
  expect(JSON.stringify(stored)).not.toContain('sk-live-secret');
  const row=stored.adapterRequests.find(entry=>entry.taskId===accepted.taskId);
  expect(row).toBeDefined();
  expect(Object.keys(row!.request).sort()).toEqual(['clientRequestId','model','prompt','surface']);
 }finally{await a.close();rmSync(dir,{recursive:true,force:true});}
});
