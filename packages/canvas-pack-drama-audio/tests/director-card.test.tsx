// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import dramaAudioPack from '../src/index';
import { DirectorCard } from '../src/director/card';

beforeAll(() => {
  // jsdom 不实现模态对话框与媒体播放。
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as never;
});
afterEach(() => cleanup());

const lines = [
  { id: 'l1', text: '第一句解说', videoStartMs: 0, videoEndMs: 1500 },
  { id: 'l2', text: '第二句解说', videoStartMs: 2000, videoEndMs: 3500 },
];

function node(data: Record<string, unknown> = {}) {
  return { id: 'drama-1', kind: 'card.drama.audio', x: 0, y: 0, title: '短剧配音', data: { videoDurationMs: 5000, rewriteLines: lines, ...data } };
}

describe('短剧配音卡渲染', () => {
  it('卡包只注册 card.drama.audio 并由导演卡渲染', () => {
    expect(dramaAudioPack.cards.map(card => card.kind)).toEqual(['card.drama.audio']);
    expect(dramaAudioPack.cards[0]?.render).toBe(DirectorCard);
  });

  it('卡面显示台词和片段数量，打开后进入工作台', () => {
    const onPatch = vi.fn();
    render(<DirectorCard node={node()} selected={false} onPatch={onPatch} />);
    expect(screen.getByText('2 句台词 · 0 个配音片段')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '打开短剧配音编辑器' }));
    expect(screen.getByRole('dialog', { name: '短剧配音编辑器' })).toBeTruthy();
    expect(screen.getByText('音频工作台')).toBeTruthy();
    expect(screen.getAllByText('第一句解说').length).toBeGreaterThan(0);
  });
});
