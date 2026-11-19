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
  Element.prototype.scrollIntoView ??= vi.fn();
  Element.prototype.scrollTo ??= vi.fn() as never;
});
afterEach(() => cleanup());

const lines = [
  { id: 'l1', text: '第一句解说', videoStartMs: 0, videoEndMs: 1500 },
  { id: 'l2', text: '第二句解说', videoStartMs: 2000, videoEndMs: 3600 },
];
const segment = { id: 'l2', label: '第二句解说', startMs: 0, endMs: 1200, gapMs: 0, gain: 1, muted: false, videoStartMs: 2000, videoEndMs: 3600 };

let latest: CardPackNode | null = null;
function Host({ initial }: { initial: Record<string, unknown> }) {
  const [node, setNode] = useState<CardPackNode>({ id: 'drama-1', kind: 'card.drama.audio', x: 0, y: 0, data: initial });
  latest = node;
  return <DirectorCard node={node} selected onPatch={patch => setNode(current => ({ ...current, data: { ...(current.data ?? {}), ...(patch.data ?? {}) } }))} />;
}
const data = () => latest?.data as Record<string, any>;

function editLine(text: string, extra: Record<string, unknown> = {}) {
  render(<Host initial={{ videoDurationMs: 6000, rewriteLines: lines, ...extra }} />);
  fireEvent.click(screen.getByRole('button', { name: '打开短剧配音编辑器' }));
  fireEvent.click(within(screen.getByRole('region', { name: '台词浏览' })).getByText(text).closest('button')!);
  return within(screen.getByRole('complementary', { name: '内容编辑与交付' }));
}
function commitNumber(field: HTMLElement, value: string) {
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

describe('逐句配音编辑', () => {
  it('本句音色可选预设、自定义和恢复继承', () => {
    const panel = editLine('第一句解说');
    void panel;
    const voice = [...document.querySelectorAll('label')].find(label => label.textContent?.startsWith('本句音色'))!.querySelector('select')!;
    fireEvent.change(voice, { target: { value: '温柔亲切的女声，语速平缓' } });
    expect(data().lineVoiceInstructions).toEqual({ l1: '温柔亲切的女声，语速平缓' });
    fireEvent.change(voice, { target: { value: '__custom__' } });
    expect(data().lineVoiceInstructions.l1).toBe('温柔亲切的女声，语速平缓');
    const custom = screen.getByLabelText('本句音色描述');
    fireEvent.change(custom, { target: { value: '带点笑意的少年音' } });
    expect(data().lineVoiceInstructions.l1).toBe('带点笑意的少年音');
    fireEvent.change(voice, { target: { value: '' } });
    expect(data().lineVoiceInstructions?.l1 ?? null).toBeNull();
  });

  it('本句音量在失焦时提交', () => {
    const panel = editLine('第一句解说');
    commitNumber(panel.getByLabelText('本句音量（0–2）'), '1.5');
    expect(data().lineGains).toEqual({ l1: 1.5 });
  });

  it('前插、后插和删除台词', () => {
    const panel = editLine('第一句解说');
    fireEvent.click(panel.getByRole('button', { name: '后插一句' }));
    expect(data().rewriteLines).toHaveLength(3);
    fireEvent.click(panel.getByRole('button', { name: '前插一句' }));
    expect(data().rewriteLines).toHaveLength(4);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(panel.getByRole('button', { name: '删除本句' }));
    expect(data().rewriteLines).toHaveLength(4);
    fireEvent.click(panel.getByRole('button', { name: '删除本句' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(data().rewriteLines).toHaveLength(3);
    confirm.mockRestore();
    for (const line of data().rewriteLines) expect(line.videoEndMs).toBeGreaterThan(line.videoStartMs);
  });

  it('修改画面入出点会重新进入待确认', () => {
    const panel = editLine('第一句解说', { confirmedLineIds: ['l1'] });
    commitNumber(panel.getByLabelText('画面出点（毫秒）'), '1200');
    expect(data().rewriteLines[0]).toMatchObject({ id: 'l1', videoEndMs: 1200 });
  });

  it('已配音句可调整音频裁剪、留白并静音', () => {
    const panel = editLine('第二句解说', { audioRef: 'session/voice/full.wav', segments: [segment] });
    expect(panel.getByText(/音频源：session\/voice\/full.wav/)).toBeTruthy();
    commitNumber(panel.getByLabelText('音频出点（毫秒）'), '1000');
    expect(data().segments[0].endMs).toBe(1000);
    commitNumber(panel.getByLabelText('句尾留白（毫秒）'), '200');
    expect(data().segments[0].gapMs).toBe(200);
    fireEvent.click(panel.getByLabelText('静音本句（保留时间位置）'));
    expect(data().segments[0].muted).toBe(true);
  });

  it('音频超过视频区间时提示截断', () => {
    const panel = editLine('第二句解说', { audioRef: 'session/voice/full.wav', segments: [{ ...segment, endMs: 2500 }] });
    expect(panel.getByText(/时长超限/)).toBeTruthy();
  });

  it('非回环地址下不能生成本机配音', () => {
    const panel = editLine('第一句解说');
    expect((panel.getByRole('button', { name: '生成配音' }) as HTMLButtonElement).disabled).toBe(true);
    expect(panel.getByText('本句尚未生成真实音频。')).toBeTruthy();
  });
  it('已有配音时按钮显示「重新生成」，音色选项写明跟随的是哪个整体音色', () => {
    const panel = editLine('第二句解说', { audioRef: 'session/voice/full.wav', segments: [segment], voiceInstruction: '温柔亲切的女声，语速平缓' });
    expect(panel.getByRole('button', { name: '重新生成' })).toBeTruthy();
    const voice = [...document.querySelectorAll('label')].find(label => label.textContent?.startsWith('本句音色'))!.querySelector('select')!;
    expect(voice.options[voice.selectedIndex]!.textContent).toBe('跟随整体：温柔女声');
    expect(panel.getByText('这句没有单独设置音色，生成时用整体音色')).toBeTruthy();
  });
});
