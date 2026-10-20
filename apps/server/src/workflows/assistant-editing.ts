import { videoGenerationLengths, VIDEO_GENERATION_RESOLUTIONS } from '@bezier/contracts';
export interface WorkflowMediaCatalog {
  video: ReadonlyArray<{ id: string; caps?: readonly string[] }>;
  aspects: readonly string[];
  videoLengthsSec: readonly number[];
}
import { applyWorkflowPropertyChanges, parseWorkflowAssistantScope, validateWorkflowNodeProperties, workflowPropertyDiff, workflowValueEqual, synchronizeWorkflowStartMetadata, type WorkflowAssistantScope, type WorkflowPropertyChange } from '@bezier/contracts';
import type { WorkflowGraphConfig } from './generic-graph.js';

export function prepareWorkflowAssistantEdit(input: {
  workflow: WorkflowGraphConfig; scope?: WorkflowAssistantScope; media?: WorkflowMediaCatalog;
  changes?: WorkflowPropertyChange[]; proposal?: WorkflowGraphConfig;
}) {
  const scope = parseWorkflowAssistantScope(input.scope);
  if (scope.mode === 'node' && !input.workflow.nodes?.some(n => n.id === scope.nodeId)) throw new Error('目标卡片已不存在');
  if (input.changes && input.proposal) throw new Error('属性修改与流程结构修改不能同时提交');
  if (!input.changes && !input.proposal) return undefined;
  if (scope.mode === 'node' && input.proposal) throw new Error('单卡模式请使用属性修改，不得替换整个流程');
  if (input.scope && input.proposal && workflowValueEqual(input.workflow.nodes?.map(n => [n.id,n.kind]),input.proposal.nodes?.map(n => [n.id,n.kind])) && workflowValueEqual(input.workflow.edges,input.proposal.edges)) {
    throw new Error('仅修改属性时必须使用 changes，以保留其他配置');
  }
  const workflow = input.changes
    ? applyWorkflowPropertyChanges(input.workflow, input.changes, scope).workflow
    : JSON.parse(JSON.stringify(input.proposal)) as WorkflowGraphConfig;
  if (workflow.id !== input.workflow.id) throw new Error('工作流 ID 不匹配');
  synchronizeWorkflowStartMetadata(input.workflow, workflow);
  const changed = input.changes ? new Set(input.changes.map(x => x.nodeId)) : undefined;
  for (const node of workflow.nodes ?? []) if (!changed || changed.has(node.id)) {
    validateWorkflowNodeProperties(node);
    const video = node.deliveryConfig?.artifactKind === 'video' ? node.deliveryConfig.video : undefined;
    if (video) {
      const mode = video.mode ?? 't2v';
      const model = input.media?.video.find(m => m.id === video.model) ?? input.media?.video.find(m => m.caps?.includes(mode));
      if (!model || !model.caps?.includes(mode)) throw new Error(`当前媒体目录没有支持 ${mode} 的视频能力`);
      if (video.duration !== undefined && !videoGenerationLengths(model.id, [...(input.media?.videoLengthsSec ?? [])]).includes(video.duration)) throw new Error(`当前视频能力支持的时长为 ${videoGenerationLengths(model.id, [...(input.media?.videoLengthsSec ?? [])]).join('、')} 秒`);
      if (model.id === 'wanqing-video' && video.resolution && video.resolution !== '720p') throw new Error('当前视频能力仅支持 720p');
    }
  }
  return { workflow, diff: workflowPropertyDiff(input.workflow, workflow) };
}

export function workflowAssistantMediaCapabilities(media?: WorkflowMediaCatalog) {
  return { video: (media?.video ?? []).map(model => ({ id: model.id, modes: model.caps, durations: videoGenerationLengths(model.id,[...(media?.videoLengthsSec ?? [])]), resolutions: model.id === 'wanqing-video' ? ['720p'] : VIDEO_GENERATION_RESOLUTIONS })), ratios: media?.aspects ?? [] };
}
