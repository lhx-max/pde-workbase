import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
import {createProjectRegistry} from '../src/storage/project-registry.js';
import {CanvasStateService} from '../src/canvas/state.js';
import {ProjectLedger} from '../src/project-ledger/service.js';
import {withProjectLedgerRecorder} from '../src/project-ledger/active-recorder.js';
import {AgentTasks,type AgentAdapter,type TaskDelivery} from '../src/services-tasks.js';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){const root=mkdtempSync(path.join(tmpdir(),'canvas-standalone-'));roots.push(root);const registry=createProjectRegistry(root);const project=registry.create({name:'Test'});const canvas=new CanvasStateService(id=>registry.resolveProjectRoot(id));return {root,registry,project,canvas};}
const waiting:AgentAdapter={execute:({signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}))};
describe('independent canvas backend',()=>{
 it('requires explicit absolute data roots',()=>{expect(()=>createProjectRegistry('relative')).toThrow();expect(()=>new ProjectLedger('relative')).toThrow();});
 it('persists original canvas-node history with idempotency and isolated roots',async()=>{
  const first=fixture(),second=fixture();const a=new ProjectLedger(first.root),b=new ProjectLedger(second.root);
  await Promise.all([
   withProjectLedgerRecorder(input=>{a.record(input);},()=>first.canvas.patch(first.project.id,{workbenchBasicNodes:[{id:'text-1',kind:'text',text:'first'}]})),
   withProjectLedgerRecorder(input=>{b.record(input);},()=>second.canvas.patch(second.project.id,{workbenchBasicNodes:[{id:'text-2',kind:'text',text:'second'}]})),
  ]);
  expect(new ProjectLedger(first.root).listEntityHistory(first.project.id,'canvas_node','text-1')).not.toHaveLength(0);
  expect(a.listEntityHistory(first.project.id,'canvas_node','text-2')).toHaveLength(0);
  const input={projectId:first.project.id,type:'test',source:'test',entityType:'canvas_node',entityId:'text-1',summary:'event',idempotencyKey:'one',payload:{token:'not a credential',password:'secret'}};
  expect(a.record(input).inserted).toBe(true);expect(a.record(input).inserted).toBe(false);
  expect(a.list(first.project.id).events[0]?.payload.password).toBe('[redacted]');expect(a.verify(first.project.id).valid).toBe(true);
 });
 it('does not pretend an unconfigured executor accepted work',async()=>{const f=fixture();await expect(new AgentTasks(f.registry,f.canvas).submit(f.project.id,{requestId:'r',prompt:'go'})).rejects.toMatchObject({status:503,code:'AGENT_ADAPTER_UNAVAILABLE'});});
 it('delivers text idempotently and preserves a manual edit on replay',async()=>{
  const f=fixture();await f.canvas.patch(f.project.id,{workbenchBasicNodes:[{id:'n',kind:'text',text:'old',generation:{requestId:'r'}}]});
  const tasks=new AgentTasks(f.registry,f.canvas,waiting);const request={requestId:'r',prompt:'revise',canvasTextGeneration:{requestId:'r',nodeId:'n',outputKind:'text' as const}};
  const task=await tasks.submit(f.project.id,request);expect((await tasks.submit(f.project.id,request)).id).toBe(task.id);
  const result=await tasks.deliver(f.project.id,task.id,{content:'new'});expect(result).toMatchObject({status:'succeeded',deliveryState:'candidate_saved'});
  expect((await f.canvas.read(f.project.id)).state.workbenchBasicNodes).toMatchObject([{text:'old',generation:{candidateText:'new'}}]);
  expect(await tasks.adoptText(f.project.id,task.id)).toMatchObject({deliveryState:'applied'});
  const snapshot=await f.canvas.read(f.project.id);const nodes=snapshot.state.workbenchBasicNodes as Record<string,unknown>[];
  await f.canvas.patch(f.project.id,{workbenchBasicNodes:nodes.map(node=>({...node,text:'manual'}))});
  await tasks.deliver(f.project.id,task.id,{content:'new'});
  expect((await f.canvas.read(f.project.id)).state.workbenchBasicNodes).toMatchObject([{text:'manual'}]);
  expect(new AgentTasks(f.registry,f.canvas).get(f.project.id,task.id)?.status).toBe('succeeded');
 });
 it('retains a text candidate without overwriting changed target',async()=>{
  const f=fixture();await f.canvas.patch(f.project.id,{workbenchBasicNodes:[{id:'n',kind:'text',text:'old',generation:{requestId:'r'}}]});
  const tasks=new AgentTasks(f.registry,f.canvas,waiting);const task=await tasks.submit(f.project.id,{requestId:'r',prompt:'revise',canvasTextGeneration:{requestId:'r',nodeId:'n'}});
  const snapshot=await f.canvas.read(f.project.id);await f.canvas.patch(f.project.id,{workbenchBasicNodes:(snapshot.state.workbenchBasicNodes as Record<string,unknown>[]).map(node=>({...node,text:'manual'}))});
  const result=await tasks.deliver(f.project.id,task.id,{content:'candidate'});expect(result).toMatchObject({status:'failed',deliveryState:'candidate_saved'});
  await expect(tasks.adoptText(f.project.id,task.id)).rejects.toMatchObject({status:409});
  expect(readFileSync(path.join(f.registry.resolveProjectRoot(f.project.id)!,result.result!.candidatePath!),'utf8')).toBe('candidate');
  expect((await f.canvas.read(f.project.id)).state.workbenchBasicNodes).toMatchObject([{text:'manual'}]);
 });
 it('preserves legacy text generation direct adoption when outputKind is omitted',async()=>{
  const f=fixture();await f.canvas.patch(f.project.id,{workbenchBasicNodes:[{id:'n',kind:'text',text:'old',generation:{requestId:'r'}}]});
  const tasks=new AgentTasks(f.registry,f.canvas,waiting);const task=await tasks.submit(f.project.id,{requestId:'r',prompt:'revise',canvasTextGeneration:{requestId:'r',nodeId:'n'}});
  expect(await tasks.deliver(f.project.id,task.id,{content:'new'})).toMatchObject({status:'succeeded',deliveryState:'applied'});
  expect((await f.canvas.read(f.project.id)).state.workbenchBasicNodes).toMatchObject([{text:'new'}]);
 });
 it('cancellation prevents publication and restart reports interrupted execution',async()=>{
  const f=fixture(),tasks=new AgentTasks(f.registry,f.canvas,waiting);const first=await tasks.submit(f.project.id,{requestId:'cancel',prompt:'go'});await tasks.cancel(f.project.id,first.id);
  await expect(tasks.deliver(f.project.id,first.id,{content:'late'})).rejects.toThrow('cancelled');
  const second=await tasks.submit(f.project.id,{requestId:'restart',prompt:'go'});expect(new AgentTasks(f.registry,f.canvas).get(f.project.id,second.id)?.status).toBe('interrupted');
  await tasks.cancel(f.project.id,second.id);
 });
 it('prevalidates all task file paths before publishing any bytes',async()=>{
  const f=fixture(),tasks=new AgentTasks(f.registry,f.canvas,waiting);const task=await tasks.submit(f.project.id,{requestId:'invalid-batch',prompt:'files'});
  expect(await tasks.deliver(f.project.id,task.id,{content:'',files:[{path:'valid.txt',content:'valid'},{path:'../outside.txt',content:'invalid'}]})).toMatchObject({status:'failed',result:{files:[]}});
  expect(existsSync(path.join(f.registry.resolveProjectRoot(f.project.id),'valid.txt'))).toBe(false);
 });
 it('exposes the genuine separately saved HTML candidate after target conflict',async()=>{
  const f=fixture();await f.canvas.patch(f.project.id,{workbenchBasicNodes:[{id:'page',kind:'page',generation:{requestId:'r'}}]});
  const tasks=new AgentTasks(f.registry,f.canvas,waiting);const task=await tasks.submit(f.project.id,{requestId:'r',prompt:'page',canvasArtifactGeneration:{requestId:'r',nodeId:'page',format:'html',outputPath:'bundle/index.html'}});
  await f.canvas.patch(f.project.id,{workbenchBasicNodes:[]});
  const result=await tasks.deliver(f.project.id,task.id,{content:'<html><body>Candidate</body></html>'});
  expect(result).toMatchObject({status:'failed',deliveryState:'candidate_saved',result:{candidatePath:'bundle/index.html',files:['bundle/index.html']}});
  expect(readFileSync(path.join(f.registry.resolveProjectRoot(f.project.id),'bundle/index.html'),'utf8')).toContain('Candidate');
 });
 it('publishes an HTML bundle only into new paths and binds through original target checks',async()=>{
  const f=fixture();await f.canvas.patch(f.project.id,{workbenchBasicNodes:[{id:'page',kind:'page',generation:{requestId:'r'}}]});
  const tasks=new AgentTasks(f.registry,f.canvas,waiting);const task=await tasks.submit(f.project.id,{requestId:'r',prompt:'page',canvasArtifactGeneration:{requestId:'r',nodeId:'page',format:'html',outputPath:'bundle/index.html'}});
  const delivery:TaskDelivery={content:'',files:[{path:'bundle/style.css',content:'body{color:red}'},{path:'bundle/index.html',content:'<html><body><link rel="stylesheet" href="style.css">Ready</body></html>'}]};
  expect(await tasks.deliver(f.project.id,task.id,delivery)).toMatchObject({status:'succeeded',deliveryState:'applied'});
  expect(readFileSync(path.join(f.registry.resolveProjectRoot(f.project.id)!,'bundle/style.css'),'utf8')).toBe('body{color:red}');
  expect((await f.canvas.read(f.project.id)).state.workbenchBasicNodes).toMatchObject([{projectFilePath:'bundle/index.html'}]);
 });
});
