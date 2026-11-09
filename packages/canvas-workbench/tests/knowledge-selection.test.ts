import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  caseFileContentBlocks,
  disabledKnowledgeNotice,
  enabledKnowledgeIds,
  knowledgeContentBlocks,
  setKnowledgeEnabled,
  type SelectableKnowledge,
} from '../src/workbench/knowledge-selection';

const storageKey = 'gr:flow-knowledge-selection';
const items = [
  { id: 'default' },
  { id: 'optional', defaultEnabled: false },
  { id: 'required', defaultEnabled: false, allowDisable: false },
];
let stored: Map<string, string>;
let events: EventTarget;

beforeEach(() => {
  stored = new Map();
  events = new EventTarget();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
    },
    dispatchEvent: (event: Event) => events.dispatchEvent(event),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('generic knowledge selection compatibility', () => {
  it('defaults to enabled items while retaining mandatory knowledge', () => {
    expect(enabledKnowledgeIds('flow', items)).toEqual(['default', 'required']);
  });

  it('honors saved choices, excludes stale IDs, and restores mandatory items', () => {
    stored.set(storageKey, JSON.stringify({ flow: ['optional', 'removed'] }));
    expect(enabledKnowledgeIds('flow', items)).toEqual(['optional', 'required']);
  });

  it.each(['invalid json', '{"flow":false}'])('falls back for invalid saved selection: %s', value => {
    stored.set(storageKey, value);
    expect(enabledKnowledgeIds('flow', items)).toEqual(['default', 'required']);
  });

  it('uses defaults if browser storage cannot be read', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw new Error('unavailable'); } } });
    expect(enabledKnowledgeIds('flow', items)).toEqual(['default', 'required']);
  });

  it('preserves the existing storage key, other flows, and change event contract', () => {
    stored.set(storageKey, JSON.stringify({ other: ['untouched'] }));
    const listener = vi.fn();
    events.addEventListener('gr:knowledge-selection-changed', listener);
    setKnowledgeEnabled('flow', 'optional', true, items);
    expect(JSON.parse(stored.get(storageKey)!)).toEqual({
      other: ['untouched'], flow: ['default', 'optional', 'required'],
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      flowId: 'flow', enabledIds: ['default', 'optional', 'required'],
    });
    setKnowledgeEnabled('flow', 'default', false, items);
    expect(enabledKnowledgeIds('flow', items)).toEqual(['optional', 'required']);
  });

  it('cannot disable mandatory items or persist unknown IDs', () => {
    const listener = vi.fn();
    events.addEventListener('gr:knowledge-selection-changed', listener);
    setKnowledgeEnabled('flow', 'required', false, items);
    expect(stored.has(storageKey)).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    setKnowledgeEnabled('flow', 'unknown', true, items);
    expect(enabledKnowledgeIds('flow', items)).toEqual(['default', 'required']);
  });
});

describe('generic context formatting', () => {
  it('states disabled knowledge without depending on a business API', () => {
    const knowledge: SelectableKnowledge[] = ['a', 'b'].map(id => ({
      id, title: id.toUpperCase(), defaultEnabled: true, allowDisable: true,
      mode: 'inline', required: false, path: `${id}.md`, instruction: '',
    }));
    expect(disabledKnowledgeNotice(knowledge, ['a', 'b'])).toBe('');
    expect(disabledKnowledgeNotice(knowledge, ['a'])).toBe('本次已禁用知识：《B》；不得读取、引用或基于这些文件作答。');
  });

  it('formats supplied knowledge and excludes missing or failed content', () => {
    expect(knowledgeContentBlocks([
      { title: '指南', instruction: '参考', content: ' 正文 \n' },
      { path: 'notes.md', content: '另一个正文' },
      { content: '不应注入', error: '读取失败' },
      {},
    ])).toEqual([
      '', '── 知识《指南》（参考）──', '正文', '── 以上为该知识全文 ──',
      '', '── 知识《notes.md》（）──', '另一个正文', '── 以上为该知识全文 ──',
    ]);
  });

  it('distinguishes complete and truncated files without treating read failures as facts', () => {
    expect(caseFileContentBlocks([
      { path: 'brief.md', purpose: '需求', content: ' 完整正文 ' },
      { path: 'history.json', content: '片段', truncated: true },
      { path: 'failed.md', error: '无权限', content: '不应注入' },
      { path: 'empty.md' },
    ])).toEqual([
      '', '── 文件《brief.md》（需求）──', '完整正文', '── 以上为该文件全文 ──',
      '', '── 文件《history.json》（）──', '片段',
      '── 以上为该文件开头部分，内容过长已截断，需要完整内容时自行读取 ──',
    ]);
  });
});

it('removes unreachable business prefetch and its command builders from the generic frontend', () => {
  const workbench = readFileSync(new URL('../src/Workbench.tsx', import.meta.url), 'utf8');
  const selection = readFileSync(new URL('../src/workbench/knowledge-selection.ts', import.meta.url), 'utf8');
  expect(/configuredFlowFacts|\/api\/knowledge-executions\/start|\/api\/plan-flow\/prefetch|线上 WIKI34/.test(workbench)).toBe(false);
  expect(/knowledgeReadLines|caseFileReadLines|\/api\/actions\/gr\.knowledge\.read|<CASE 绝对路径>/.test(selection)).toBe(false);
});
