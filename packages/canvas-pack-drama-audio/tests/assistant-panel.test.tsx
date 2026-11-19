// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardPackNode } from '@bezier/canvas-card-sdk';
import { DirectorCard } from '../src/director/card';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
  Element.prototype.scrollIntoView ??= vi.fn();
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
});

let downloads: string[] = [];
beforeEach(() => {
  downloads = [];
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) { downloads.push(this.download); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const lines = [
  { id: 'l1', text: '第一句解说', videoStartMs: 0, videoEndMs: 1500 },
  { id: 'l2', text: '第二句解说', videoStartMs: 2000, videoEndMs: 3500 },
];
const take = (id: string, audioMs: number, window: [number, number]) => ({ id, label: id, startMs: 0, endMs: audioMs, gapMs: 0, gain: 1, muted: false, videoStartMs: window[0], videoEndMs: window[1], audioRefOverride: `session/voice/${id}.wav` });
const voiced = () => ({ videoDurationMs: 5000, rewriteLines: lines, audioRef: null,
  segments: [take('l1', 1200, [0, 1500]), take('l2', 1000, [2000, 3500])],
  generatedLineTexts: { l1: '第一句解说', l2: '第二句解说' }, generatedLineVoices: { l1: '自然清晰的普通话解说', l2: '自然清晰的普通话解说' } });

let latest: CardPackNode | null = null;
function Host({ initial }: { initial: Record<string, unknown> }) {
  const [node, setNode] = useState<CardPackNode>({ id: 'drama-1', kind: 'card.drama.audio', x: 0, y: 0, data: initial });
  latest = node;
  return <DirectorCard node={node} selected onPatch={patch => setNode(current => ({ ...current, ...patch, data: { ...(current.data ?? {}), ...(patch.data ?? {}) } }))} />;
}
function open(data: Record<string, unknown> = voiced()) {
  render(<Host initial={data} />);
  fireEvent.click(screen.getByRole('button', { name: '打开短剧配音编辑器' }));
}
const data = () => latest?.data as Record<string, any>;
const assistant = () => within(screen.getByRole('complementary', { name: '配音助手' }));
function say(text: string) {
  fireEvent.change(assistant().getByRole('textbox', { name: '告诉助手想怎么改' }), { target: { value: text } });
  fireEvent.click(assistant().getByRole('button', { name: '发送' }));
}
const speedOf = (id: string) => (data().segments as { id: string; speed?: number }[]).find(item => item.id === id)!.speed;

describe('配音助手', () => {
  it('先列出改动，应用后一次生效并重新贴合，撤销后恢复', () => {
    open();
    expect(assistant().getByText('第 3 句慢一点')).toBeTruthy();
    say('第 2 句太赶了，慢一点，前面停半秒');
    expect(assistant().getByText('第二句太赶了，慢一点，前面停半秒'.replace('第二句', '第 2 句'))).toBeTruthy();
    expect(assistant().getByText('第 2 句语速 100% → 90%')).toBeTruthy();
    expect(assistant().getByText('第 1、2 句间隔 → 500 ms')).toBeTruthy();
    expect(assistant().getByText('之后重新贴合视频')).toBeTruthy();
    expect(speedOf('l2')).toBeUndefined();

    fireEvent.click(assistant().getByRole('button', { name: '应用' }));
    expect(speedOf('l2')).toBe(0.9);
    expect(data().lineJoins).toEqual({ l2: 500 });
    const second = (data().rewriteLines as { videoStartMs: number }[])[1]!;
    expect(second.videoStartMs).toBe(1700);
    expect(assistant().getByText(/已应用/u)).toBeTruthy();
    expect(assistant().getByText(/配音排到/u)).toBeTruthy();

    fireEvent.click(assistant().getByRole('button', { name: '撤销' }));
    expect(speedOf('l2')).toBeUndefined();
    expect(data().lineJoins ?? null).toBeNull();
    expect(assistant().getByText('已撤销')).toBeTruthy();
  });

  it('取消后不修改，听不懂时给出示例', () => {
    open();
    say('第 1 句大声一点');
    fireEvent.click(assistant().getByRole('button', { name: '取消' }));
    expect(assistant().getByText('已取消')).toBeTruthy();
    expect(data().lineGains).toBeUndefined();
    say('帮我写首诗');
    expect(assistant().getByText(/没听懂这句/u)).toBeTruthy();
  });

  it('改台词与设音色基准', () => {
    open();
    say('把第1句改成「她回来了，带着答案。」');
    fireEvent.click(assistant().getByRole('button', { name: '应用' }));
    expect((data().rewriteLines as { text: string }[])[0]!.text).toBe('她回来了，带着答案。');
    say('用第 2 句的声音统一全部');
    fireEvent.click(assistant().getAllByRole('button', { name: '应用' }).at(-1)!);
    expect(data().voiceReference).toMatchObject({ lineId: 'l2', audioRef: 'session/voice/l2.wav' });
  });

  it('命令直接执行：检查、跳转、导出、撤销', async () => {
    open({ videoDurationMs: 5000, rewriteLines: lines });
    fireEvent.click(assistant().getByRole('button', { name: '检查问题' }));
    expect(await assistant().findByText(/发现 \d+ 个问题/u)).toBeTruthy();
    say('跳到第2句');
    expect(await assistant().findByText('已定位到第 2 句。')).toBeTruthy();
    expect(within(screen.getByRole('complementary', { name: '内容编辑' })).getByRole('heading', { name: '第 2 句' })).toBeTruthy();
    say('导出字幕');
    await waitFor(() => expect(downloads).toContain('短剧台词.srt'));
    say('撤销');
    expect(await assistant().findByText('没有可以撤销的修改。')).toBeTruthy();
    fireEvent.click(assistant().getByRole('button', { name: '补齐配音' }));
    expect(await assistant().findByText(/本机配音需要/u)).toBeTruthy();
  });

  it('没有配音的句子说明原因，可收起和展开', () => {
    open({ videoDurationMs: 5000, rewriteLines: lines });
    say('第1句语速120%');
    expect(assistant().getByText('第 1 句还没有配音，无法调整语速。')).toBeTruthy();
    fireEvent.click(assistant().getByRole('button', { name: '收起助手' }));
    expect(screen.queryByRole('complementary', { name: '配音助手' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '打开配音助手' }));
    expect(screen.getByRole('complementary', { name: '配音助手' })).toBeTruthy();
  });

  it('回车发送，示例里带省略号的只填入输入框', () => {
    open();
    const input = assistant().getByRole('textbox', { name: '告诉助手想怎么改' }) as HTMLTextAreaElement;
    fireEvent.click(assistant().getByRole('button', { name: '把第 2 句改成……' }));
    expect(input.value).toBe('把第 2 句改成');
    fireEvent.change(input, { target: { value: '第 1 句静音' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(assistant().getByText('第 1 句静音', { selector: 'li' })).toBeTruthy();
  });
});
