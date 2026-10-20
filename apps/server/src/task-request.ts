import { createHash } from 'node:crypto';
import type { CanvasTaskExecutionContext, CanvasTaskRequest } from '@bezier/contracts';

function object(value: unknown, keys: string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key))) throw new Error(`Unsupported ${label} field`);
  return result;
}
function text(value: unknown, max: number, label: string, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}
function skillIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 8 || value.some(id => id !== 'page-recreation')) throw new Error('Unsupported task skill id');
  return [...new Set(value)] as string[];
}
function executionContext(value: unknown): CanvasTaskExecutionContext {
  const v = object(value, ['skillIds', 'sessionMode', 'visiblePrompt', 'context'], 'execution context');
  if (v.sessionMode !== undefined && v.sessionMode !== 'design') throw new Error('Unsupported session mode');
  const result: CanvasTaskExecutionContext = {
    ...(v.skillIds !== undefined ? { skillIds: skillIds(v.skillIds) } : {}),
    ...(v.sessionMode !== undefined ? { sessionMode: 'design' } : {}),
    ...(v.visiblePrompt !== undefined ? { visiblePrompt: text(v.visiblePrompt, 4096, 'visible prompt', true) } : {}),
  };
  if (v.context !== undefined) {
    const context = object(v.context, ['skillIds', 'workspaceItems'], 'source context');
    result.context = { ...(context.skillIds !== undefined ? { skillIds: skillIds(context.skillIds) } : {}) };
    if (context.workspaceItems !== undefined) {
      if (!Array.isArray(context.workspaceItems) || context.workspaceItems.length > 16) throw new Error('Invalid workspace item count');
      result.context.workspaceItems = context.workspaceItems.map(value => {
        const item = object(value, ['id', 'kind', 'label', 'url', 'title', 'tabId'], 'browser source');
        if (item.kind !== 'browser') throw new Error('Unsupported workspace source kind');
        const url = text(item.url, 4096, 'browser URL'); const parsed = new URL(url);
        if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || /[\r\n\t]/u.test(url)) throw new Error('Invalid browser URL');
        // URLs are evidence, not permission to fetch. Never transmit obvious credential-bearing links.
        for (const key of parsed.searchParams.keys()) if (/^(?:access_token|refresh_token|token|password|secret|api[_-]?key|authorization|cookie)$/iu.test(key)) throw new Error('Credential-bearing browser URL');
        return { id: text(item.id, 4608, 'source id'), kind: 'browser' as const, label: text(item.label, 1024, 'source label', true), url,
          title: text(item.title, 1024, 'source title', true), ...(item.tabId !== undefined ? { tabId: text(item.tabId, 256, 'tab id') } : {}) };
      });
    }
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 32 * 1024) throw new Error('Execution context exceeds 32 KB');
  return result;
}
function inputPath(value: unknown): string {
  const relative = text(value, 1024, 'input path');
  if (/[\\?#:%\r\n\t]/u.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) throw new Error('Invalid input path');
  return relative;
}
/** Normalize once before persistence/execution; unknown authority fields are rejected, not retained. */
export function normalizeTaskRequest(value: unknown): CanvasTaskRequest {
  const v = object(value, ['requestId', 'prompt', 'designSystemId', 'taskContext', 'canvasTextGeneration', 'canvasArtifactGeneration', 'inputPaths', 'executionContext'], 'task request');
  const result: CanvasTaskRequest = { requestId: text(v.requestId, 256, 'requestId'), prompt: text(v.prompt, 1024 * 1024, 'prompt') };
  if (v.designSystemId !== undefined) result.designSystemId = text(v.designSystemId, 256, 'design system id');
  if (v.executionContext !== undefined) result.executionContext = executionContext(v.executionContext);
  if (v.inputPaths !== undefined) {
    if (!Array.isArray(v.inputPaths) || v.inputPaths.length > 100) throw new Error('Invalid input path count');
    result.inputPaths = [...new Set(v.inputPaths.map(inputPath))];
  }
  if (v.taskContext !== undefined) {
    const context = object(v.taskContext, ['targetLabel', 'baseVersionSource', 'baseVersionKind'], 'task context');
    if (context.baseVersionKind !== undefined && !['target-snapshot', 'submission-input'].includes(String(context.baseVersionKind))) throw new Error('Invalid base version kind');
    result.taskContext = {
      ...(context.targetLabel !== undefined ? { targetLabel: text(context.targetLabel, 4096, 'target label', true) } : {}),
      ...(context.baseVersionSource !== undefined ? { baseVersionSource: text(context.baseVersionSource, 1024 * 1024, 'base version source', true) } : {}),
      ...(context.baseVersionKind !== undefined ? { baseVersionKind: context.baseVersionKind as 'target-snapshot' | 'submission-input' } : {}),
    };
  }
  if (v.canvasTextGeneration !== undefined) {
    const b = object(v.canvasTextGeneration, ['requestId', 'nodeId', 'outputKind'], 'text binding');
    if (b.outputKind !== undefined && !['text', 'storyboard'].includes(String(b.outputKind))) throw new Error('Invalid text output kind');
    result.canvasTextGeneration = { requestId: text(b.requestId, 256, 'binding request id'), nodeId: text(b.nodeId, 256, 'node id'), ...(b.outputKind !== undefined ? { outputKind: b.outputKind as 'text' | 'storyboard' } : {}) };
  }
  if (v.canvasArtifactGeneration !== undefined) {
    const b = object(v.canvasArtifactGeneration, ['requestId', 'nodeId', 'format', 'outputPath'], 'artifact binding');
    if (!['html', 'presentation'].includes(String(b.format))) throw new Error('Invalid artifact format');
    result.canvasArtifactGeneration = { requestId: text(b.requestId, 256, 'binding request id'), nodeId: text(b.nodeId, 256, 'node id'), format: b.format as 'html' | 'presentation', ...(b.outputPath !== undefined ? { outputPath: inputPath(b.outputPath) } : {}) };
  }
  return result;
}
export function taskRequestDigest(request: CanvasTaskRequest): string {
  return createHash('sha256').update(JSON.stringify(normalizeTaskRequest(request))).digest('hex');
}
