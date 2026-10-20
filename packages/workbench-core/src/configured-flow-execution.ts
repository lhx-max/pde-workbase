import type { PlanFlowContract, PlanFlowStep } from './plan-flow-contract';

export type ConfiguredFlowExecutionContext = {
  contextLines: string[];
  knowledgeInstruction: string;
  /**
   * 上游事实段：后端预读好的 CASE 文件正文，加上仍需 AI 自己读的清单。
   *
   * 调用方不再手写「通过 GET /api/files?path=… 读取 原始/指令.md、…」——
   * 那行字此前在八个调用点各写一遍，措辞都不一样，改一处不影响其他处，
   * 流程卡上也完全看不出这一步会读什么。现在它由 MD 的 `#### 读取文件` 决定。
   */
  caseFactLines?: string[];
  count?: number;
  resultContainer?: string;
  resultFields?: string[];
  /** Revision runs use the previous result and user feedback, not knowledge packs. */
  revision?: boolean;
};

function dispatchPlan(flow: PlanFlowContract): PlanFlowStep[] {
  return flow.steps.filter(step => step.actor === 'AI');
}

function aiStepLines(step: PlanFlowStep, index: number): string[] {
  return [
    `${index + 1}. ${step.title}：${step.instruction}`,
    ...(step.requirements || []).map(requirement => `   - ${requirement}`),
  ];
}

/**
 * 按流程契约生成真正发送给 AI 的执行指令。
 *
 * 卡面和执行共用同一份契约：步骤、要求、数量、字段、Action 与收尾都不在调用方重写。
 */
export function buildConfiguredFlowInstruction(
  flow: PlanFlowContract,
  context: ConfiguredFlowExecutionContext,
): string {
  const count = context.count ?? flow.output.count;
  const resultContainer = context.resultContainer || flow.output.container || 'result';
  const resultFields = context.resultFields || flow.output.fields;
  const steps = dispatchPlan(flow);
  const knowledge = context.revision ? '' : context.knowledgeInstruction.trim();
  return [
    '【任务输入】',
    ...context.contextLines,
    ...(context.caseFactLines?.length ? [context.caseFactLines.join('\n')] : []),
    '',
    ...(knowledge ? ['【参考知识】', knowledge, ''] : []),
    '【生成任务】',
    ...steps.filter(step => step.actor === 'AI').flatMap(aiStepLines),
    '',
    ...((flow.constraints?.lines || []).length
      ? ['【结果约束】', ...flow.constraints.lines.map(line => `- ${line}`), '']
      : []),
    '【输出】',
    `${flow.output.shape === 'object'
      ? `{"${resultContainer}":{${resultFields.map(field => `"${field}":"..."`).join(',')}}}`
      : `{"candidates":[{${resultFields.map(field => `"${field}":"..."`).join(',')}}]}`
    }`,
    ...(flow.output.shape === 'object'
      ? []
      : [`candidates 直接包含 ${count} 个最终候选，每项只填写 ${resultFields.join('、')}，不增加其他层级。`]),
    '只输出 JSON，不添加标签、代码块或说明文字。',
  ].filter(line => line !== '').join('\n');
}
