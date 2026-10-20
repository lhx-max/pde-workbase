import { parseDocument } from 'yaml';
import type { JsonValue } from './common.js';
import type { WorkflowAssistantScope, WorkflowPropertyChange, WorkflowPropertyDiff } from './api/workflow-assistant.js';
import { normalizeWorkflowExecutionConfirmation } from './workflow-artifact.js';
import { workflowNodeProperties, workflowPropertyAt, validateWorkflowProperty } from './workflow-properties.js';

type RecordValue = Record<string, unknown>;
export function workflowRecord(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('工作流配置对象无效');
  return value as RecordValue;
}
function nodesOf(graph: unknown): RecordValue[] {
  const nodes = workflowRecord(graph).nodes;
  if (!Array.isArray(nodes)) throw new Error('工作流缺少卡片');
  return nodes.map(workflowRecord);
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).filter(([,v]) => v !== undefined).map(([k,v]) => [k,stable(v)]));
  return value;
}
export function workflowValueEqual(a: unknown, b: unknown): boolean { return JSON.stringify(stable(a)) === JSON.stringify(stable(b)); }
export function workflowConfigurationRevision(graph: unknown): string {
  if (!graph) return 'null';
  const { updatedAt: _time, stages: _stages, ...rest } = workflowRecord(graph);
  return JSON.stringify(stable(rest));
}
export function parseWorkflowAssistantScope(value: unknown): WorkflowAssistantScope {
  if (value === undefined) return { mode: 'global' };
  const scope = workflowRecord(value);
  if (scope.mode === 'global') return { mode: 'global' };
  if (scope.mode === 'node' && typeof scope.nodeId === 'string' && scope.nodeId) return { mode: 'node', nodeId: scope.nodeId };
  throw new Error('修改范围无效');
}
export function workflowValueAt(root: unknown, path: readonly string[]): unknown {
  let value = root;
  for (const key of path) value = value && typeof value === 'object' ? (value as RecordValue)[key] : undefined;
  return value;
}
function setAt(root: RecordValue, path: readonly string[], value: unknown, remove: boolean) {
  let object = root;
  for (const key of path.slice(0,-1)) {
    if (Array.isArray(object) && (!Number.isSafeInteger(Number(key)) || Number(key) >= object.length)) throw new Error('请通过完整列表添加项目，不能使用不存在的序号');
    if (object[key] === undefined) object[key] = {};
    if (!object[key] || typeof object[key] !== 'object') throw new Error(`配置路径不存在：${path.join('.')}`);
    object = object[key] as RecordValue;
  }
  const last = path.at(-1)!;
  if (Array.isArray(object)) {
    const index = Number(last);
    if (!Number.isInteger(index) || index < 0 || index >= object.length) throw new Error('请通过完整列表添加项目，不能使用不存在的序号');
    if (remove) object.splice(index, 1); else object[index] = value;
  } else if (remove) delete object[last]; else object[last] = value;
}
function mergeChange(node: RecordValue, path: string[], value: unknown) {
  const schema = workflowPropertyAt(String(node.kind), path);
  validateWorkflowProperty(value, schema, path.join('.'));
  if (schema.type === 'object') {
    if (workflowValueAt(node, path) === undefined) setAt(node, path, {}, false);
    for (const [key, child] of Object.entries(workflowRecord(value))) mergeChange(node, [...path,key], child);
  } else setAt(node, path, value, false);
}
export function validateWorkflowNodeProperties(node: unknown): void {
  const n = workflowRecord(node);
  const fields = workflowNodeProperties(String(n.kind));
  for (const [key, schema] of Object.entries(fields)) if (n[key] !== undefined) validateWorkflowProperty(n[key], schema, `${n.title || n.id}.${key}`);
  const clarify = n.clarificationConfig as RecordValue | undefined;
  if (clarify) {
    const auto = clarify.autoConfig as RecordValue | undefined;
    if (auto?.allowedTypes && (auto.allowedTypes as unknown[]).length === 0) throw new Error('至少允许一种题型');
    if (clarify.mode === 'configured') {
      const questions = clarify.questions as RecordValue[] | undefined;
      if (!questions?.length) throw new Error('手动询问至少需要一道问题');
      const ids = new Set();
      for (const q of questions) {
        if (typeof q.id !== 'string' || !q.id.trim() || ids.has(q.id)) throw new Error('题目 ID 缺失或重复');
        ids.add(q.id);
        if ((q.titleMode ?? 'manual') === 'manual' && !String(q.title ?? '').trim()) throw new Error('手写题目不能为空');
        if (q.titleMode === 'ai' && !String(q.titleDirection ?? '').trim()) throw new Error('AI 出题方向不能为空');
      }
    }
  }
  const confirmation = (n.agentConfig as RecordValue | undefined)?.confirmation as RecordValue | undefined;
  if (confirmation?.selection === 'none' && confirmation.selectionRequired === true) throw new Error('无需选择时不能要求必选');
  if (confirmation?.feedbackRequired === true && confirmation.feedbackEnabled === false) throw new Error('反馈必填需要先允许反馈');
  const delivery = n.deliveryConfig as RecordValue | undefined;
  const video = delivery?.artifactKind === 'video' ? delivery.video as RecordValue | undefined : undefined;
  if ((video?.mode === 'i2v' || video?.mode === 'firstlast') && !video.firstFrameUrl) throw new Error('图生视频需要真实首帧，请先选择素材');
  if (video?.mode === 'firstlast' && !video.lastFrameUrl) throw new Error('首尾帧模式需要真实尾帧，请先选择素材');
}
/** Apply only explicitly named fields; object values merge, arrays explicitly replace. */
export function applyWorkflowPropertyChanges<T>(base: T, changes: readonly WorkflowPropertyChange[], scope: WorkflowAssistantScope): { workflow: T; diff: WorkflowPropertyDiff[] } {
  if (!Array.isArray(changes) || changes.length > 200) throw new Error('属性修改列表无效或过大');
  const graph = JSON.parse(JSON.stringify(base)) as T;
  const nodes = nodesOf(graph);
  if (scope.mode === 'node' && !nodes.some(n => n.id === scope.nodeId)) throw new Error('目标卡片已不存在');
  const touched = new Set<string>();
  for (const raw of changes) {
    const change = workflowRecord(raw);
    const { nodeId, path, op, value } = change;
    if (typeof nodeId !== 'string' || !Array.isArray(path) || !path.length || path.length > 10 || path.some(x => typeof x !== 'string') || !['set','remove'].includes(String(op))) throw new Error('属性修改格式无效');
    if (scope.mode === 'node' && nodeId !== scope.nodeId) throw new Error('单卡模式不能修改其他卡片');
    const node = nodes.find(n => n.id === nodeId);
    if (!node) throw new Error(`目标卡片不存在：${nodeId}`);
    workflowPropertyAt(String(node.kind), path);
    if (op === 'remove') setAt(node, path, undefined, true);
    else mergeChange(node, path, value);
    touched.add(nodeId);
  }
  for (const node of nodes.filter(n => touched.has(String(n.id)))) {
    const old = nodesOf(base).find(n => n.id === node.id)!;
    if (scope.mode === 'node' && node.kind === 'branch') {
      const ids = (n: RecordValue) => ((n.branchConfig as RecordValue)?.routes as RecordValue[] | undefined)?.map(r => r.id);
      if (!workflowValueEqual(ids(old), ids(node))) throw new Error('修改分支数量或端口需要切换到整个流程');
    }
    const agent = node.agentConfig as RecordValue | undefined;
    if (agent?.confirmation) {
      const c = workflowRecord(agent.confirmation);
      if (c.selection === 'none') c.selectionRequired = false;
      if (c.feedbackEnabled === false) c.feedbackRequired = false;
      if (c.enabled === false) delete agent.confirmation;
      else agent.confirmation = normalizeWorkflowExecutionConfirmation(c);
    }
    const delivery = node.deliveryConfig as RecordValue | undefined;
    if (delivery && (old.deliveryConfig as RecordValue | undefined)?.artifactKind !== delivery.artifactKind) {
      for (const key of ['text','page','presentation','image','video']) if (key !== delivery.artifactKind) delete delivery[key];
    }
    const explicitlySets = (target: string[]) => changes.some((c: WorkflowPropertyChange) => c.nodeId === node.id && c.op === 'set'
      && c.path.length <= target.length && c.path.every((key, index) => target[index] === key)
      && workflowValueAt(c.value, target.slice(c.path.length)) !== undefined);
    if (explicitlySets(['deliveryConfig','presentation','length']) && !explicitlySets(['deliveryConfig','presentation','pages'])) {
      const ppt = delivery?.presentation as RecordValue | undefined;
      if (ppt) delete ppt.pages;
    }
    validateWorkflowNodeProperties(node);
  }
  return { workflow: graph, diff: workflowPropertyDiff(base, graph) };
}
export function workflowPropertyDiff(before: unknown, after: unknown): WorkflowPropertyDiff[] {
  const result: WorkflowPropertyDiff[] = [];
  for (const node of nodesOf(after)) {
    const old = nodesOf(before).find(n => n.id === node.id);
    if (!old) { result.push({ nodeId: String(node.id), title: String(node.title), path: [], label: '新增卡片', after: node as JsonValue }); continue; }
    const visit = (a: unknown, b: unknown, path: string[]) => {
      if (workflowValueEqual(a,b)) return;
      if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
        for (const key of new Set([...Object.keys(a),...Object.keys(b)])) visit((a as RecordValue)[key], (b as RecordValue)[key], [...path,key]);
      } else {
        let label = path.join('.');
        try { label = workflowPropertyAt(String(node.kind),path).description; } catch { /* derived/system field */ }
        result.push({ nodeId: String(node.id), title: String(node.title), path, label, ...(a === undefined ? {} : { before: a as JsonValue }), ...(b === undefined ? {} : { after: b as JsonValue }) });
      }
    };
    for (const key of Object.keys(workflowNodeProperties(String(node.kind)))) visit(old[key],node[key],[key]);
  }
  for (const node of nodesOf(before)) if (!nodesOf(after).some(n => n.id === node.id)) result.push({ nodeId: String(node.id), title: String(node.title), path: [], label: '删除卡片', before: node as JsonValue });
  return result;
}
export function assertWorkflowChangesPersisted(expected: unknown, actual: unknown, diff: readonly WorkflowPropertyDiff[]): void {
  // Canonical storage may add defaults, but must retain every authored value,
  // including settings outside the edited paths.
  const contains = (a: unknown, b: unknown, path: string[]): boolean => {
    if (a && typeof a === 'object' && !Array.isArray(a)) return !!b && typeof b === 'object'
      && Object.entries(a).every(([key, value]) => value === undefined || contains(value, (b as RecordValue)[key], [...path,key]));
    if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((value, index) => contains(value,b[index],[...path,String(index)]));
    return workflowValueEqual(savedValue(a,path), savedValue(b,path));
  };
  for (const node of nodesOf(expected)) {
    const saved = nodesOf(actual).find(n => n.id === node.id);
    if (!contains(node,saved,[])) throw new Error(`保存后的「${node.title}」未保留完整配置，未应用`);
  }
  for (const change of diff) {
    const expectedNode = nodesOf(expected).find(n => n.id === change.nodeId);
    const actualNode = nodesOf(actual).find(n => n.id === change.nodeId);
    if (change.path.length === 0 && expectedNode) continue;
    if (!workflowValueEqual(savedValue(workflowValueAt(expectedNode, change.path), change.path), savedValue(workflowValueAt(actualNode, change.path), change.path))) throw new Error(`保存后的「${change.title} · ${change.label}」与修改方案不一致，未应用`);
  }
}

/** Keep the Start metadata and its editable WORKFLOW.md in agreement. */
export function synchronizeWorkflowStartMetadata(before: unknown, after: unknown): void {
  const node = nodesOf(after).find(n => n.kind === 'start');
  const old = nodesOf(before).find(n => n.id === node?.id)?.startConfig as RecordValue | undefined;
  const config = node?.startConfig as RecordValue | undefined;
  if (!config) return;
  if (workflowValueEqual(old, config)) return;
  if (config.workflowMarkdown && config.workflowMarkdown === old?.workflowMarkdown) {
    const match = String(config.workflowMarkdown).match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/u);
    if (match) {
      const doc = parseDocument(match[1]!);
      if (doc.errors.length) throw new Error('场景说明元信息格式错误');
      if (config.workflowName !== old?.workflowName) doc.set('name', config.workflowName);
      if (config.description !== old?.description) doc.set('description', config.description);
      if (JSON.stringify(config.triggerScenarios) !== JSON.stringify(old?.triggerScenarios)) doc.set('scenarios', config.triggerScenarios ?? []);
      config.workflowMarkdown = `---\n${doc.toString()}---\n${match[2] ?? ''}`;
    }
  }
  if (config.workflowMarkdown) {
    const match = String(config.workflowMarkdown).match(/^---\s*\n([\s\S]*?)\n---/u);
    if (!match) throw new Error('场景说明需要有效的 YAML 元信息');
    const doc = parseDocument(match[1]!);
    if (doc.errors.length) throw new Error('场景说明元信息格式错误');
    const data = workflowRecord(doc.toJSON());
    if (typeof data.name === 'string') config.workflowName = data.name;
    if (typeof data.description === 'string') config.description = data.description;
    if (Array.isArray(data.scenarios) && data.scenarios.every(x => typeof x === 'string')) config.triggerScenarios = data.scenarios;
  }
  if (config.workflowName) workflowRecord(after).title = config.workflowName;
}

function savedValue(value: unknown, path: readonly string[]): unknown {
  if (path.at(-1) !== 'workflowMarkdown' || typeof value !== 'string') return value;
  const match = value.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/u);
  return match ? { metadata: parseDocument(match[1]!).toJSON(), body: match[2]?.trim() } : value;
}
