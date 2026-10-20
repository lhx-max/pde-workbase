import Database from './helpers/workflow-database.js';
import express from 'express';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerWorkflowGraphRoutes } from '../src/routes/workflow-graphs.js';
import { GenericWorkflowGraphService, type WorkflowGraphConfig } from '../src/workflows/generic-graph.js';
import { migrateWorkflows } from '../src/workflows/persistence.js';
import { WorkflowResultService } from '../src/workflows/results.js';
import type { WorkflowAssistantPort } from '../src/workflows/ports.js';
const runOneShotAgent = vi.fn<WorkflowAssistantPort['complete']>();
import { prepareWorkflowAssistantEdit } from '../src/workflows/assistant-editing.js';
import type { WorkflowAssistantResponse } from '@bezier/contracts';
type TestBody = Omit<WorkflowAssistantResponse, 'proposal'> & {
 workflow: WorkflowGraphConfig & {nodes: NonNullable<WorkflowGraphConfig['nodes']>};
 proposal?: WorkflowGraphConfig;
 error?: {message: string};
 verified?: boolean;
};
const graph: WorkflowGraphConfig = { id:'editing-test',version:2,title:'报告',updatedAt:'2026-09-23',nodes:[
  {id:'start',kind:'start',title:'开始',description:'',startConfig:{workflowName:'报告',description:'场景',triggerScenarios:['周报'],includeProjectContext:true}},
  {id:'work',kind:'agent',title:'执行',description:'生成报告',agentConfig:{systemPrompt:'写报告',skillIds:[],knowledgeIds:[]}},
  {id:'out',kind:'delivery',title:'产物',description:'',deliveryConfig:{artifactKind:'text',artifactName:'报告正文',requirements:'只写事实',text:{length:'short',templateId:'existing',templatePrompt:'现有模板'}}},
],edges:[{id:'a',source:'start',target:'work'},{id:'b',source:'work',target:'out'}]};
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {vi.clearAllMocks();for (const close of cleanup.splice(0).reverse()) await close();});
async function harness() {
 const dir=await mkdtemp(path.join(tmpdir(),'workflow-edit-'));cleanup.push(()=>rm(dir,{recursive:true,force:true}));
 const db=new Database(':memory:');migrateWorkflows(db);cleanup.push(async()=>{db.close();});
 const service=new GenericWorkflowGraphService(db,new WorkflowResultService(db));service.register();
 const app=express();app.use(express.json({limit:'4mb'}));
 registerWorkflowGraphRoutes(app,{service,assistant:{complete:runOneShotAgent},dataDir:dir,workflowsDir:path.join(dir,'built-in'),builtInSkillsDir:path.resolve(import.meta.dirname,'../../../resources/skills'),authorizeProjectRequest:async()=>{throw new Error('no execution');}});
 const server:Server=await new Promise(resolve=>{const s=app.listen(0,()=>resolve(s));});cleanup.push(()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())));
 const call=async(suffix:string,body?:unknown,method=body?'POST':'GET')=>{
  const res=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/workflow-graphs/${graph.id}${suffix}`,{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:res.status,body:await res.json() as TestBody};
 };
 return {service,call};
}
const changes=[{nodeId:'out',op:'set',path:['deliveryConfig','text','length'],value:'long'}];
const scope={mode:'node',nodeId:'out'};
describe('workflow assistant precise editing HTTP',()=>{
 it('creates a new flow from a structural proposal and reloads its settings',async()=>{
  const h=await harness();
  const base={...graph,nodes:[],edges:[]};
  vi.mocked(runOneShotAgent).mockResolvedValue({text:JSON.stringify({reply:'新流程',proposal:graph}),agentId:'codex'});
  const assisted=await h.call('/assistant',{workflow:base,message:'创建报告流程',scope:{mode:'global'},agentId:'codex'});
  expect(assisted.body.error).toBeUndefined();
  const applied=await h.call('/assistant/apply',{workflow:base,proposal:assisted.body.proposal,scope:{mode:'global'},persistedRevision:assisted.body.persistedRevision});
  expect(applied.body.error).toBeUndefined();expect(applied.status).toBe(200);
  expect((await h.call('')).body.workflow.nodes[2]!.deliveryConfig!).toEqual(graph.nodes![2]!.deliveryConfig);
 });
 it('applies a real property edit, preserves unrelated settings, and survives reload',async()=>{
  const h=await harness();const saved=await h.call('',graph,'PUT');expect(saved.status).toBe(200);
  const loaded=await h.call('');expect(loaded.body.persistedRevision).toBe(saved.body.persistedRevision);
  const base=loaded.body.workflow;
  vi.mocked(runOneShotAgent).mockResolvedValue({text:JSON.stringify({reply:'调整篇幅',changes}),agentId:'codex'});
  const assisted=await h.call('/assistant',{workflow:base,persistedRevision:loaded.body.persistedRevision,message:'改成长篇',scope,agentId:'codex',model:'gpt-6-luna'});
  expect(assisted.status).toBe(200);expect(assisted.body.diff).toHaveLength(1);
  expect(vi.mocked(runOneShotAgent).mock.calls[0]![0].prompt).toContain('cameraMove');
  const applied=await h.call('/assistant/apply',{workflow:base,proposal:assisted.body.proposal,changes:assisted.body.changes,scope,persistedRevision:assisted.body.persistedRevision});
  expect(applied.status).toBe(200);expect(applied.body.verified).toBe(true);
  const reloaded=await h.call('');expect(reloaded.body.workflow.nodes.find((n:{id:string})=>n.id==='out')!.deliveryConfig).toEqual({...graph.nodes![2]!.deliveryConfig,text:{...graph.nodes![2]!.deliveryConfig!.text,length:'long'}});
 });
 it.each([
  [[{nodeId:'work',path:['agentConfig','systemPrompt'],op:'set',value:'越界'}],'单卡'],
  [[{nodeId:'out',path:['deliveryConfig','image','count'],op:'set',value:99}],'允许值'],
  [[{nodeId:'out',path:['deliveryConfig','text','length'],op:'set',value:'epic'}],'允许值'],
 ] as const)('rejects bad changes before presenting a proposal',async(change,error)=>{
  const h=await harness();vi.mocked(runOneShotAgent).mockResolvedValue({text:JSON.stringify({reply:'改好了',changes:change}),agentId:'codex'});
  const res=await h.call('/assistant',{workflow:graph,message:'改一下',scope,agentId:'codex'});
  expect(res.status).toBe(502);expect(res.body.error?.message).toContain(error);expect(h.service.getConfig(graph.id)).toBeNull();
 });
  it('rejects stale proposals after another save',async()=>{
  const h=await harness();const saved=await h.call('',graph,'PUT');
  vi.mocked(runOneShotAgent).mockResolvedValue({text:JSON.stringify({reply:'调整',changes}),agentId:'codex'});
  const assisted=await h.call('/assistant',{workflow:saved.body.workflow,message:'改成长篇',scope,agentId:'codex'});
  const other=structuredClone(saved.body.workflow);other.nodes[2]!.deliveryConfig!.requirements='人工更新';await h.call('',other,'PUT');
  const applied=await h.call('/assistant/apply',{workflow:saved.body.workflow,proposal:assisted.body.proposal,changes,scope,persistedRevision:assisted.body.persistedRevision});
  expect(applied.status).toBe(409);expect((await h.call('')).body.workflow.nodes[2]!.deliveryConfig!.requirements).toBe('人工更新');
 });
 it('rejects an outdated client before invoking the model',async()=>{
  const h=await harness();const saved=await h.call('',graph,'PUT');
  const staleRevision=saved.body.persistedRevision;const staleGraph=structuredClone(saved.body.workflow);
  const newer=structuredClone(saved.body.workflow);newer.nodes[2]!.deliveryConfig!.requirements='另一端已更新';await h.call('',newer,'PUT');
  const response=await h.call('/assistant',{workflow:staleGraph,persistedRevision:staleRevision,message:'改成长篇',scope,agentId:'codex'});
  expect(response.status).toBe(409);expect(response.body.error?.message).toContain('已被修改');expect(runOneShotAgent).not.toHaveBeenCalled();
  const legacy=await h.call('/assistant',{workflow:staleGraph,message:'改成长篇',scope,agentId:'codex'});
  expect(legacy.status).toBe(409);expect(runOneShotAgent).not.toHaveBeenCalled();
  expect((await h.call('')).body.workflow.nodes[2]!.deliveryConfig!.requirements).toBe('另一端已更新');
 });
 it('accepts an unsaved editor draft when it carries the last server revision',async()=>{
  const h=await harness();const saved=await h.call('',graph,'PUT');
  const draft=structuredClone(saved.body.workflow);draft.nodes[2]!.deliveryConfig!.requirements='本地尚未保存的要求';
  vi.mocked(runOneShotAgent).mockResolvedValue({text:JSON.stringify({reply:'调整篇幅',changes}),agentId:'codex'});
  const assisted=await h.call('/assistant',{workflow:draft,persistedRevision:saved.body.persistedRevision,message:'改成长篇',scope,agentId:'codex'});
  expect(assisted.status).toBe(200);
  const applied=await h.call('/assistant/apply',{workflow:draft,proposal:assisted.body.proposal,changes:assisted.body.changes,scope,persistedRevision:assisted.body.persistedRevision});
  expect(applied.status).toBe(200);expect((await h.call('')).body.workflow.nodes[2]!.deliveryConfig).toMatchObject({requirements:'本地尚未保存的要求',text:{length:'long'}});
 });
 it('renames Start metadata and persists the same values after canonical markdown rendering',async()=>{
  const h=await harness();const saved=await h.call('',graph,'PUT');
  const changes=[{nodeId:'start',path:['startConfig','workflowName'],op:'set',value:'财务报告'}];
  const scope={mode:'node',nodeId:'start'};
  vi.mocked(runOneShotAgent).mockResolvedValue({text:JSON.stringify({reply:'改名',changes}),agentId:'codex'});
  const assisted=await h.call('/assistant',{workflow:saved.body.workflow,message:'改名',scope,agentId:'codex'});
  const applied=await h.call('/assistant/apply',{workflow:saved.body.workflow,proposal:assisted.body.proposal,changes,scope,persistedRevision:assisted.body.persistedRevision});
  expect(applied.body.error).toBeUndefined();expect(applied.status).toBe(200);expect((await h.call('')).body.workflow.title).toBe('财务报告');
 });
 it('serializes simultaneous apply requests so only one can use a revision',async()=>{
  const h=await harness();const saved=await h.call('',graph,'PUT');
  vi.mocked(runOneShotAgent).mockResolvedValue({text:JSON.stringify({reply:'调整',changes}),agentId:'codex'});
  const assisted=await h.call('/assistant',{workflow:saved.body.workflow,message:'改成长篇',scope,agentId:'codex'});
  const request={workflow:saved.body.workflow,proposal:assisted.body.proposal,changes,scope,persistedRevision:assisted.body.persistedRevision};
  const result=await Promise.all([h.call('/assistant/apply',request),h.call('/assistant/apply',request)]);
  expect(result.map(r=>r.status).sort()).toEqual([200,409]);
 });
 it('synchronizes Start metadata with its existing markdown without losing body',()=>{
  const before=structuredClone(graph);before.nodes![0]!.startConfig!.workflowMarkdown='---\nid: editing-test\nname: 报告\ndescription: 场景\nscenarios: [周报]\n---\n# 原正文\n保留方法';
  const edit=prepareWorkflowAssistantEdit({workflow:before,scope:{mode:'node',nodeId:'start'},changes:[{nodeId:'start',path:['startConfig','workflowName'],op:'set',value:'财务报告'}]});
  expect(edit!.workflow.title).toBe('财务报告');expect(edit!.workflow.nodes![0]!.startConfig!.workflowMarkdown).toContain('name: 财务报告');expect(edit!.workflow.nodes![0]!.startConfig!.workflowMarkdown).toContain('保留方法');
 });
});
