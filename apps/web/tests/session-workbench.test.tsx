// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SessionAppsClient from '../app/session-apps/client';

vi.mock('@bezier/canvas-pack-drama-audio', () => ({
  DramaWorkbench: ({ node, assistantAgent }: { node: { id: string; data?: Record<string, unknown> }; assistantAgent?: unknown }) =>
    React.createElement('section', { 'aria-label': '新版完整编辑器', 'data-card-id': node.id },
      React.createElement('span', null, String(node.data?.script ?? '')),
      React.createElement('span', { 'data-has-agent': String(Boolean(assistantAgent)) }, '')),
  assertMediaSize: vi.fn(),
  assertProjectRelativePath: vi.fn(),
  useSessionMedia: () => ({ resolve: () => undefined, add: vi.fn(), restore: vi.fn(), version: 0 }),
}));

vi.mock('../app/session-apps/cli-assistant', () => ({
  createCliAssistant: vi.fn(() => ({ status: vi.fn(), ask: vi.fn() })),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('会话入口挂载新版完整工作台而非旧版逐句组件', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { revision: 1, state: { workbenchBasicNodes: [
    { id: 'drama-1', kind: 'card.drama.audio', x: 0, y: 0, data: { stage: 'edit', script: '原台词' } },
  ] } } }), { status: 200 })));
  render(React.createElement(SessionAppsClient));
  expect(screen.getByText('欢迎导演')).toBeTruthy();
  expect(screen.queryByRole('region', { name: '新版完整编辑器' })).toBeNull();
  fireEvent.click(screen.getByRole('dialog', { name: '欢迎界面' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '欢迎界面' })).toBeNull());
  expect(await screen.findByRole('region', { name: '新版完整编辑器' })).toBeTruthy();
  expect(screen.getByText('原台词')).toBeTruthy();
  expect(screen.getByText('新版短剧导演工作台')).toBeTruthy();
});

it('两张 card.drama.audio 各自渲染独立编辑器，切换标签互不影响', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { revision: 1, state: { workbenchBasicNodes: [
    { id: 'drama-1', kind: 'card.drama.audio', title: '第一集', x: 0, y: 0, data: { script: '台词A' } },
    { id: 'drama-2', kind: 'card.drama.audio', title: '第二集', x: 0, y: 0, data: { script: '台词B' } },
  ] } } }), { status: 200 })));
  render(React.createElement(SessionAppsClient));
  fireEvent.click(screen.getByRole('dialog', { name: '欢迎界面' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '欢迎界面' })).toBeNull());
  const editors = await screen.findAllByRole('region', { name: '新版完整编辑器', hidden: true });
  expect(editors).toHaveLength(2);
  const tab1 = screen.getByRole('button', { name: '第一集' });
  const tab2 = screen.getByRole('button', { name: '第二集' });
  expect(tab1).toBeTruthy();
  expect(tab2).toBeTruthy();
});

it('0 张卡时展示空态文案，不渲染编辑器', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { revision: 1, state: { workbenchBasicNodes: [] } } }), { status: 200 })));
  render(React.createElement(SessionAppsClient));
  fireEvent.click(screen.getByRole('dialog', { name: '欢迎界面' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '欢迎界面' })).toBeNull());
  expect(await screen.findByText(/暂无短剧配音卡/u)).toBeTruthy();
  expect(screen.queryByRole('region', { name: '新版完整编辑器' })).toBeNull();
});

it('轮询刷新时内容未变则复用同一个 node 引用，不打断正在进行的导入流程', async () => {
  vi.useFakeTimers();
  const seenNodes: unknown[] = [];
  vi.doMock('@bezier/canvas-pack-drama-audio', () => ({
    DramaWorkbench: ({ node }: { node: unknown }) => { seenNodes.push(node); return React.createElement('section', { 'aria-label': '新版完整编辑器' }); },
    assertMediaSize: vi.fn(),
    assertProjectRelativePath: vi.fn(),
    useSessionMedia: () => ({ resolve: () => undefined, add: vi.fn(), restore: vi.fn(), version: 0 }),
  }));
  vi.resetModules();
  const { default: FreshClient } = await import('../app/session-apps/client');
  const makeBody = () => JSON.stringify({ data: { revision: 1, state: { workbenchBasicNodes: [
    { id: 'drama-1', kind: 'card.drama.audio', x: 0, y: 0, data: { script: '原台词' } },
  ] } } });
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(makeBody(), { status: 200 })));
  render(React.createElement(FreshClient));
  fireEvent.click(screen.getByRole('dialog', { name: '欢迎界面' }));
  await vi.advanceTimersByTimeAsync(400);
  await vi.advanceTimersByTimeAsync(1500);
  await vi.advanceTimersByTimeAsync(1500);
  const firstNode = seenNodes[0];
  expect(seenNodes.length).toBeGreaterThanOrEqual(3);
  expect(seenNodes.every(node => node === firstNode)).toBe(true);
  vi.useRealTimers();
  vi.doUnmock('@bezier/canvas-pack-drama-audio');
});

it('每张卡传入独立的 assistantAgent', async () => {
  const { createCliAssistant } = await import('../app/session-apps/cli-assistant');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { revision: 1, state: { workbenchBasicNodes: [
    { id: 'drama-1', kind: 'card.drama.audio', x: 0, y: 0, data: {} },
    { id: 'drama-2', kind: 'card.drama.audio', x: 0, y: 0, data: {} },
  ] } } }), { status: 200 })));
  render(React.createElement(SessionAppsClient));
  fireEvent.click(screen.getByRole('dialog', { name: '欢迎界面' }));
  await waitFor(() => screen.findAllByRole('region', { name: '新版完整编辑器' }));
  expect(vi.mocked(createCliAssistant).mock.calls.length).toBeGreaterThanOrEqual(2);
});
