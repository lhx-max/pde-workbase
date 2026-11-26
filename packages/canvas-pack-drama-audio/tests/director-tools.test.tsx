// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CardPackNode } from '@bezier/canvas-card-sdk';
import { DirectorCard } from '../src/director/card';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
  Element.prototype.scrollIntoView ??= vi.fn();
  Element.prototype.scrollTo ??= vi.fn() as never;
});
afterEach(() => cleanup());

const lines = [
  { id: 'l1', text: '第一句解说', videoStartMs: 0, videoEndMs: 1500 },
  { id: 'l2', text: '第二句解说', videoStartMs: 2000, videoEndMs: 3500 },
  { id: 'l3', text: '第三句解说', videoStartMs: 4000, videoEndMs: 4800 },
];

function Host({ initial }: { initial: Record<string, unknown> }) {
  const [node, setNode] = useState<CardPackNode>({ id: 'drama-1', kind: 'card.drama.audio', x: 0, y: 0, data: initial });
  return <DirectorCard node={node} selected onPatch={patch => setNode(current => ({ ...current, data: { ...(current.data ?? {}), ...(patch.data ?? {}) } }))} />;
}

function open(extra: Record<string, unknown> = {}) {
  render(<Host initial={{ videoDurationMs: 6000, rewriteLines: lines, ...extra }} />);
  fireEvent.click(screen.getByRole('button', { name: '打开短剧配音编辑器' }));
  return within(screen.getByRole('region', { name: '导演工具' }));
}

describe('导演工具：播放控制条', () => {
  it('保留播放、回听与试听音轨切换，不再有选区工具折叠面板', () => {
    const tools = open();
    expect(tools.getByRole('button', { name: '播放' })).toBeTruthy();
    expect(tools.getByRole('button', { name: '回听 3 秒' })).toBeTruthy();
    expect(tools.getByText('在时间轴框选，或点选一句台词')).toBeTruthy();
    expect(screen.queryByText('选区工具 · 音量与节奏')).toBeNull();
    expect(tools.queryByRole('group', { name: '编辑工具' })).toBeNull();
  });

  it('无背景音乐轨时不显示背景试听轨，有背景轨时显示', () => {
    const tools = open();
    expect(within(tools.getByRole('group', { name: '试听音轨' })).queryByRole('button', { name: '背景音乐' })).toBeNull();
    cleanup();
    const withBackground = open({ directorBackgroundRef: 'inputs/bgm.mp3', directorBackgroundDurationMs: 6000 });
    expect(within(withBackground.getByRole('group', { name: '试听音轨' })).getByRole('button', { name: '背景音乐' })).toBeTruthy();
  });

  it('切换试听音轨后 aria-pressed 随之变化', () => {
    const tools = open();
    const group = tools.getByRole('group', { name: '试听音轨' });
    fireEvent.click(within(group).getByRole('button', { name: '原声' }));
    expect(within(group).getByRole('button', { name: '原声' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(group).getByRole('button', { name: '混合' }).getAttribute('aria-pressed')).toBe('false');
  });
});
