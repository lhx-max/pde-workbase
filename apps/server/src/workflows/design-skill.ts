import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { WorkflowGraphConfig } from '../workflows/generic-graph.js';

export const WORKFLOW_DESIGN_SKILL_ID = 'workflow-design';
export interface WorkflowDesignSkill {
  id: string;
  digest: string;
  instructions: string;
  catalog: Array<{ id: string; description: string }>;
}

/** Load trusted product resources, not a same-name user override. All required
 * references are injected because the one-shot assistant cannot fetch them. */
export async function loadWorkflowDesignSkill(builtInSkillsDir: string, authorizedCatalog: WorkflowDesignSkill['catalog'] = []): Promise<WorkflowDesignSkill> {
  const root = path.join(builtInSkillsDir, WORKFLOW_DESIGN_SKILL_ID);
  const files = ['SKILL.md', 'references/engine-contract.md'];
  const documents = await Promise.all(files.map(async file => {
    const body = await readFile(path.join(root, file), 'utf8').catch(() => {
      throw new Error(`工作流设计 Skill 资源不可用：${file}，请修复应用资源后重试`);
    });
    if (!body.trim() || body.length > 48_000) throw new Error(`工作流设计 Skill 文件为空或过大：${file}`);
    return `--- ${file} ---\n${body}`;
  }));
  const instructions = documents.join('\n\n');
  const catalog = authorizedCatalog
    .filter(skill => skill.id !== WORKFLOW_DESIGN_SKILL_ID)
    .map(skill => ({ id: skill.id, description: skill.description.slice(0, 600) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { id: WORKFLOW_DESIGN_SKILL_ID, digest: createHash('sha256').update(instructions).digest('hex'), instructions, catalog };
}

/** Existing private bindings survive editing, but the assistant may not invent
 * new resources that were never provided through an authorized catalog. */
export function validateWorkflowAssistantBindings(proposal: WorkflowGraphConfig, current: WorkflowGraphConfig, skill: WorkflowDesignSkill): void {
  const allowedSkills = new Set(skill.catalog.map(item => item.id));
  const allowedKnowledge = new Set<string>();
  for (const node of current.nodes ?? []) {
    for (const id of node.agentConfig?.skillIds ?? []) allowedSkills.add(id);
    for (const id of node.agentConfig?.knowledgeIds ?? []) allowedKnowledge.add(id);
  }
  for (const node of proposal.nodes ?? []) {
    for (const id of node.agentConfig?.skillIds ?? []) {
      if (!allowedSkills.has(id)) throw new Error(`工作流引用了未提供的 Skill：${id}`);
    }
    for (const id of node.agentConfig?.knowledgeIds ?? []) {
      if (!allowedKnowledge.has(id)) throw new Error(`工作流引用了未提供的知识：${id}`);
    }
  }
}
