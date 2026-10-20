import express from 'express';import {once} from 'node:events';import type {AddressInfo} from 'node:net';import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';import os from 'node:os';import path from 'node:path';import {expect,it,vi} from 'vitest';
import {createHttpAgentAdapter} from '../src/http-adapters.js';import {AgentTasks,type TaskReceipt} from '../src/services-tasks.js';import {createProjectRegistry} from '../src/storage/project-registry.js';import {CanvasStateService} from '../src/canvas/state.js';
it('sends pinned staged bytes and ephemeral execution context over the real HTTP adapter',async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'canvas-http-agent-'));const registry=createProjectRegistry(root),project=registry.create({name:'Remote agent'}),canvas=new CanvasStateService(id=>registry.resolveProjectRoot(id));
 writeFileSync(path.join(registry.resolveProjectRoot(project.id),'source.txt'),'pinned input');
 const remote=express();remote.use(express.json());let received:Record<string,any>|undefined;
 remote.post('/agent/execute',(req,res)=>{received=req.body;expect(req.headers.authorization).toBe('Bearer adapter-token');res.json({content:'remote result'});});
 const listener=remote.listen(0,'127.0.0.1');await once(listener,'listening');
 const tasks=new AgentTasks(registry,canvas,createHttpAgentAdapter(`http://127.0.0.1:${(listener.address() as AddressInfo).port}/agent/execute`,'adapter-token'));
 let settle!:(receipt:TaskReceipt)=>void;const completion=new Promise<TaskReceipt>(resolve=>{settle=resolve;});const original=tasks.deliver.bind(tasks);vi.spyOn(tasks,'deliver').mockImplementation(async(...args)=>{const result=await original(...args);settle(result);return result;});
 try{
  const task=await tasks.submit(project.id,{requestId:'remote',prompt:'Use staged source',inputPaths:['source.txt']},{execution:{mode:'api',model:'selected/model',byokProvider:{protocol:'openai',apiKey:'ephemeral-key',baseUrl:'https://provider.example/v1'}},systemPrompt:'ephemeral-system',skillIds:['workflow-design']});
  expect(await completion).toMatchObject({status:'succeeded',result:{content:'remote result'}});
  expect(received?.execution.byokProvider.apiKey).toBe('ephemeral-key');expect(received?.systemPrompt).toBe('ephemeral-system');expect(received?.skillIds).toEqual(['workflow-design']);
  expect(received?.inputFiles).toHaveLength(1);expect(Buffer.from(received!.inputFiles[0].contentBase64,'base64').toString()).toBe('pinned input');expect(received!.inputFiles[0].digest).toMatch(/^[a-f0-9]{64}$/);
  const stored=readFileSync(path.join(root,'agent-tasks',`${task.id}.json`),'utf8');expect(stored).not.toContain('ephemeral-key');expect(stored).not.toContain('ephemeral-system');expect(stored).not.toContain('workflow-design');
 }finally{await new Promise<void>((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));rmSync(root,{recursive:true,force:true});}
});
it('rejects changed staged bytes before making any provider request',async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'canvas-http-pinned-'));try{writeFileSync(path.join(root,'input.txt'),'changed');await expect(createHttpAgentAdapter('http://127.0.0.1:1/execute').execute({task:{id:'t',projectId:'p',requestId:'r',status:'running',createdAt:0,updatedAt:0},request:{requestId:'r',prompt:'x'},workspace:{cwd:root,projectRoot:root,inputs:[{path:'input.txt',digest:'0'.repeat(64)}]},signal:new AbortController().signal})).rejects.toThrow('digest changed');}finally{rmSync(root,{recursive:true,force:true});}
});
