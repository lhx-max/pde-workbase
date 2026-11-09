import { describe, expect, it } from 'vitest';
import { applyWorkflowPropertyChanges, validateWorkflowNodeProperties, workflowConfigurationRevision, assertWorkflowChangesPersisted } from '../src/workflow-editing.js';
import { ARTIFACT_PROPERTY_SCHEMAS, WORKFLOW_NODE_PROPERTIES, workflowPropertyAt } from '../src/workflow-properties.js';
import type { WorkflowPropertyChange } from '../src/api/workflow-assistant.js';
const base = { id: 'test', nodes: [
  { id: 'start', kind: 'start', title: '开始', description: '', startConfig: { workflowName: '报告', description: '场景', includeProjectContext: true, triggerScenarios: ['周报'] } },
  { id: 'ask', kind: 'clarify', title: '询问', clarificationConfig: { mode: 'configured', questions: [{ id: 'q', titleMode: 'manual', title: '目标？', type: 'text', required: false, allowOther: false }] } },
  { id: 'work', kind: 'agent', title: '执行', agentConfig: { systemPrompt: '写报告', skillIds: ['existing'], knowledgeIds: ['known'], confirmation: { selection: 'single', selectionRequired: true, feedbackEnabled: true, feedbackRequired: true } } },
  { id: 'branch', kind: 'branch', title: '判断', branchConfig: { instruction: '判断信息', routes: [{id:'ready',label:'足够',condition:'资料完整'},{id:'missing',label:'不足',condition:'资料缺失'}], defaultRouteId: 'missing' } },
  { id: 'out', kind: 'delivery', title: '产物', deliveryConfig: { artifactKind: 'presentation', artifactName: '周报', requirements: '真实事实', presentation: { pages: 8, length: 'standard', template: 'brand', templatePrompt: '黑白' } } },
], edges: [{id:'a',source:'start',target:'work'}, {id:'b',source:'work',target:'out'}] };
const set = (nodeId: string, path: string[], value: import('../src/common.js').JsonValue): WorkflowPropertyChange => ({nodeId,path,op:'set',value});
const apply = (changes: WorkflowPropertyChange[], nodeId = 'out') => applyWorkflowPropertyChanges(base, changes, {mode:'node',nodeId});
describe('workflow property editing', () => {
  it('updates one nested property without erasing template, knowledge, other cards or edges', () => {
    const result = apply([set('out',['deliveryConfig','presentation','pages'],12)]);
    expect(result.workflow.nodes[4]?.deliveryConfig).toEqual({...base.nodes[4]!.deliveryConfig,presentation:{...base.nodes[4]!.deliveryConfig!.presentation,pages:12}});
    expect(result.workflow.nodes.slice(0,4)).toEqual(base.nodes.slice(0,4));
    expect(result.workflow.edges).toEqual(base.edges);
    expect(result.diff.map(d => d.path.join('.'))).toEqual(['deliveryConfig.presentation.pages']);
    expect(base.nodes[4]!.deliveryConfig!.presentation.pages).toBe(8);
  });
  it('merges object updates; deletion must be explicit', () => {
    expect(apply([set('out',['deliveryConfig'],{presentation:{pages:12}})]).workflow.nodes[4]!.deliveryConfig!.artifactName).toBe('周报');
    expect(apply([{nodeId:'out',path:['deliveryConfig','artifactName'],op:'remove'}]).workflow.nodes[4]!.deliveryConfig).not.toHaveProperty('artifactName');
  });
  it.each([
    set('work',['agentConfig','systemPrompt'],'change'),
    set('out',['id'],'evil'), set('out',['kind'],'agent'), set('out',['deliveryConfig','unknown'],3),
    set('out',['__proto__','polluted'],true), set('out',['deliveryConfig','presentation','pages'],-1),
    set('out',['deliveryConfig','image','count'],99), set('out',['deliveryConfig','text','length'],'epic'),
    set('out',['deliveryConfig','image','model'],'new-model'),
    set('out',['deliveryConfig','image'],{model:'new-model'}),
  ])('rejects out-of-scope, unknown, read-only or illegal values: %j', change => expect(() => apply([change])).toThrow());
  it('supports each card kind and single-question editing', () => {
    expect(apply([set('start',['startConfig','includeProjectContext'],false)],'start').workflow.nodes[0]!.startConfig!.includeProjectContext).toBe(false);
    expect(apply([set('ask',['clarificationConfig','questions','0','required'],true)],'ask').workflow.nodes[1]!.clarificationConfig!.questions[0]!.title).toBe('目标？');
    expect(apply([set('work',['agentConfig','systemPrompt'],'证据先行')],'work').workflow.nodes[2]!.agentConfig!.knowledgeIds).toEqual(['known']);
    expect(apply([set('branch',['branchConfig','routes','0','condition'],'目标、预算都完整')],'branch').workflow.nodes[3]!.branchConfig!.routes[1]!.id).toBe('missing');
  });
  it('keeps branch ports stable in single card mode', () => expect(() => apply([set('branch',['branchConfig','routes','0','id'],'new')],'branch')).toThrow('分支'));
  it('rejects missing or noncanonical question indexes', () => {
    expect(() => apply([set('ask',['clarificationConfig','questions','99','title'],'目标？')],'ask')).toThrow('序号');
    expect(() => apply([set('ask',['clarificationConfig','questions','00','title'],'目标？')],'ask')).toThrow('配置项');
  });
  it('synchronizes confirmation dependencies and both projections', () => {
    const changed = apply([set('work',['agentConfig','confirmation','selection'],'none'),set('work',['agentConfig','confirmation','feedbackEnabled'],false)],'work').workflow.nodes[2]!.agentConfig!.confirmation;
    expect(changed).toMatchObject({selection:'none',selectionRequired:false,feedbackRequired:false,chat:{selection:'none',feedbackRequired:false},canvas:{selection:'none',feedbackRequired:false}});
  });
  it('clears confirmation only on an explicit removal', () => expect(apply([{nodeId:'work',path:['agentConfig','confirmation'],op:'remove'}],'work').workflow.nodes[2]!.agentConfig).not.toHaveProperty('confirmation'));
  it('clears old exact page count when changing length', () => expect(apply([set('out',['deliveryConfig','presentation','length'],'detailed')]).workflow.nodes[4]!.deliveryConfig!.presentation).not.toHaveProperty('pages'));
  it('handles the same page-count dependency in object patches', () => {
    expect(apply([set('out',['deliveryConfig'],{presentation:{length:'detailed'}})]).workflow.nodes[4]!.deliveryConfig!.presentation).not.toHaveProperty('pages');
    expect(apply([set('out',['deliveryConfig'],{presentation:{length:'detailed',pages:15}})]).workflow.nodes[4]!.deliveryConfig!.presentation.pages).toBe(15);
  });
  it('rejects missing image-to-video frames and invalid inquiry rules', () => {
    expect(() => validateWorkflowNodeProperties({kind:'delivery',deliveryConfig:{artifactKind:'video',video:{mode:'firstlast',firstFrameUrl:'real'}}})).toThrow('尾帧');
    expect(() => apply([set('ask',['clarificationConfig','autoConfig','maxQuestions'],6)],'ask')).toThrow();
    expect(() => apply([set('ask',['clarificationConfig','autoConfig','allowedTypes'],[])],'ask')).toThrow();
  });
  it('compares saved values and rejects lost properties', () => {
    const changed = apply([set('out',['deliveryConfig','presentation','pages'],12)]);
    expect(() => assertWorkflowChangesPersisted(changed.workflow,base,changed.diff)).toThrow('未保留完整配置');
    expect(() => assertWorkflowChangesPersisted(changed.workflow,changed.workflow,changed.diff)).not.toThrow();
    const lost = structuredClone(changed.workflow);
    lost.nodes[2]!.agentConfig!.knowledgeIds = [];
    expect(() => assertWorkflowChangesPersisted(changed.workflow,lost,changed.diff)).toThrow('未保留完整配置');
  });
  it('has property documentation for all five artifact kinds and every exposed config root', () => {
    expect(Object.keys(ARTIFACT_PROPERTY_SCHEMAS).sort()).toEqual(['image','page','presentation','text','video']);
    for (const kind of ['start','clarify','agent','branch','delivery']) expect(Object.keys(WORKFLOW_NODE_PROPERTIES[kind]!)).toHaveLength(1);
    expect(workflowPropertyAt('delivery',['deliveryConfig','video','cameraMove','move']).values).toContain('dolly_zoom');
    expect(workflowPropertyAt('delivery',['deliveryConfig','text','length']).values).toEqual(['auto','short','medium','long']);
  });
  it('revision ignores timestamps and object key order, but observes config edits', () => {
    expect(workflowConfigurationRevision({...base,updatedAt:'a'})).toEqual(workflowConfigurationRevision({updatedAt:'b',...base}));
    expect(workflowConfigurationRevision(base)).not.toEqual(workflowConfigurationRevision(apply([set('out',['deliveryConfig','presentation','pages'],12)]).workflow));
  });
});
