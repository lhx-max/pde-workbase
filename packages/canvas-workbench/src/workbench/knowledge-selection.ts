import { cr } from '../locales/canvas-remainder';
// Historical key and change-event name are compatibility contracts, not a business-module dependency.
const STORAGE_KEY = 'gr:flow-knowledge-selection';

type SelectionMap = Record<string, string[]>;

export type SelectableKnowledge = {
  id: string;
  title: string;
  defaultEnabled: boolean;
  allowDisable: boolean;
  mode: 'inline' | 'agent' | 'extract' | 'evaluation';
  required: boolean;
  path: string;
  instruction: string;
};

function readMap(): SelectionMap {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as SelectionMap;
  } catch {
    return {};
  }
}

export function enabledKnowledgeIds(
  flowId: string,
  items: Array<{ id: string; defaultEnabled?: boolean; allowDisable?: boolean }>,
): string[] {
  const allIds = items.map(item => item.id);
  const saved = readMap()[flowId];
  const defaults = items.filter(item => item.defaultEnabled !== false).map(item => item.id);
  const enabled = new Set(Array.isArray(saved) ? saved : defaults);
  for (const item of items) {
    if (item.allowDisable === false) enabled.add(item.id);
  }
  return allIds.filter(id => enabled.has(id));
}

export function setKnowledgeEnabled(
  flowId: string,
  knowledgeId: string,
  enabled: boolean,
  items: Array<{ id: string; defaultEnabled?: boolean; allowDisable?: boolean }>,
) {
  const allIds = items.map(item => item.id);
  const target = items.find(item => item.id === knowledgeId);
  if (!enabled && target?.allowDisable === false) return;
  const current = new Set(enabledKnowledgeIds(flowId, items));
  if (enabled) current.add(knowledgeId);
  else current.delete(knowledgeId);
  const next = { ...readMap(), [flowId]: allIds.filter(id => current.has(id)) };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('gr:knowledge-selection-changed', {
    detail: { flowId, enabledIds: next[flowId] },
  }));
}

export function disabledKnowledgeNotice(items: SelectableKnowledge[], enabledIds: string[]): string {
  const enabled = new Set(enabledIds);
  const disabled = items.filter(item => !enabled.has(item.id));
  if (!disabled.length) return '';
  return cr().knowledgeDisabled(disabled.map(item => cr().quotedTitle(item.title)).join(cr().listSep));
}

/** 后端预取回传的单份知识；失败时只有 error，没有 content */
export type PrefetchedKnowledge = {
  id?: string;
  title?: string;
  path?: string;
  instruction?: string;
  content?: string;
  error?: string;
};

/** 将调用方提供的知识正文组装为上下文；不负责读取或选择业务知识源。 */
export function knowledgeContentBlocks(items: PrefetchedKnowledge[]): string[] {
  return items.flatMap(item => (
    item.error || !item.content ? [] : [
      '',
      cr().knowledgeHeader(item.title || item.path || '', item.instruction || ''),
      item.content.trim(),
      cr().knowledgeFooter,
    ]
  ));
}

/** 预读回传的单份文件；保留历史类型名称，失败时只有 error，没有 content。 */
export type PrefetchedCaseFile = {
  path: string;
  purpose?: string;
  content?: string;
  truncated?: boolean;
  error?: string;
};

/**
 * 把调用方提供的文件正文包成给 AI 的事实块，不依赖业务目录或接口。
 *
 * 和知识块用同一套围栏写法：对模型来说这两类都是「已经给你了、不用再取」的正文，
 * 长成两种样子只会让它多一种格式要理解。
 */
export function caseFileContentBlocks(items: PrefetchedCaseFile[]): string[] {
  return items.flatMap(item => (
    item.error || !item.content ? [] : [
      '',
      cr().fileHeader(item.path, item.purpose || ''),
      item.content.trim(),
      // 截断必须说出来：模型看到的是残缺 JSON，不告知它就会把「没读到」当成「不存在」，
      // 进而漏掉后面的轮次或产品，而现场看不出任何异常。
      item.truncated
        ? cr().fileTruncated
        : cr().fileFooter,
    ]
  ));
}
