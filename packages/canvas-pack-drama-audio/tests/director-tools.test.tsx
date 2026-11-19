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
  { id: 'l2', text: '第二句解说', videoStartMs: 2000, videoEndMs: 3500 },
  { id: 'l3', text: '第三句解说', videoStartMs: 4000, videoEndMs: 4800 },
];

let latest: CardPackNode | null = null;
function Host({ initial }: { initial: Record<string, unknown> }) {
  const [node, setNode] = useState<CardPackNode>({ id: 'drama-1', kind: 'card.drama.audio', x: 0, y: 0, data: initial });
  latest = node;
  return <DirectorCard node={node} selected onPatch={patch => setNode(current => ({ ...current, data: { ...(current.data ?? {}), ...(patch.data ?? {}) } }))} />;
}

function open(extra: Record<string, unknown> = {}) {
  render(<Host initial={{ videoDurationMs: 6000, rewriteLines: lines, ...extra }} />);
  fireEvent.click(screen.getByRole('button', { name: '打开短剧配音编辑器' }));
  return within(screen.getByRole('region', { name: '导演工具' }));
}
const selectLine = (text: string) => fireEvent.click(within(screen.getByRole('region', { name: '台词浏览' })).getByText(text).closest('button')!);
const tab = (tools: ReturnType<typeof open>, name: string) => fireEvent.click(within(tools.getByRole('group', { name: '编辑工具' })).getByRole('button', { name }));
const data = () => latest?.data as Record<string, any>;

describe('导演工具：选区与试听', () => {
  it('加入当前句形成选区，可移除与清空', () => {
    const tools = open();
    selectLine('第二句解说');
    fireEvent.click(tools.getByRole('button', { name: '加入当前句' }));
    fireEvent.click(tools.getByRole('button', { name: '加入当前句' }));
    expect(tools.getAllByRole('button', { name: /^移除选区/ })).toHaveLength(1);
    fireEvent.click(tools.getByRole('button', { name: '移除选区 1' }));
    expect(tools.queryByRole('button', { name: /^移除选区/ })).toBeNull();
    selectLine('第一句解说');
    fireEvent.click(tools.getByRole('button', { name: '加入当前句' }));
    fireEvent.click(tools.getByRole('button', { name: '清空选区' }));
    expect(tools.queryByRole('button', { name: /^移除选区/ })).toBeNull();
  });

  it('精确输入选区校验范围', () => {
    const tools = open();
    const [start, end] = [tools.getByLabelText('起点（秒）'), tools.getByLabelText('终点（秒）')];
    fireEvent.change(start, { target: { value: '3' } });
    fireEvent.change(end, { target: { value: '2' } });
    fireEvent.click(tools.getByRole('button', { name: '添加区间' }));
    expect(tools.getByText('请输入视频时长内的起点和终点，起点需早于终点。')).toBeTruthy();
    fireEvent.change(end, { target: { value: '4.5' } });
    fireEvent.click(tools.getByRole('button', { name: '添加区间' }));
    expect(tools.getByRole('button', { name: '移除选区 1' })).toBeTruthy();
  });

  it('锁定选区后阻止修改其中的台词，解锁后恢复', () => {
    const tools = open();
    selectLine('第二句解说');
    fireEvent.click(tools.getByRole('button', { name: '加入当前句' }));
    fireEvent.click(tools.getByRole('button', { name: '锁定选区' }));
    expect(data().directorEdit.locks).toEqual([{ startMs: 2000, endMs: 3500 }]);
    expect(document.querySelector('[data-preview-line-id="l2"]')?.getAttribute('data-locked')).toBe('true');
    fireEvent.click(screen.getAllByRole('button', { name: /删除/ })[0]!);
    expect(within(screen.getByRole('region', { name: '台词浏览' })).getByText('第二句解说')).toBeTruthy();
    fireEvent.click(tools.getByRole('button', { name: '解锁 2.00 秒 – 3.50 秒' }));
    expect(data().directorEdit.locks).toEqual([]);
  });

  it('保存并采用时间方案', () => {
    const tools = open();
    fireEvent.click(within(tools.getByRole('group', { name: '时间方案 A' })).getByRole('button', { name: '存为 A' }));
    expect(tools.getByText('已保存方案 A，包含 3 句的时间区间。')).toBeTruthy();
    expect(Object.keys(data().directorEdit.arrangements.A.windows)).toEqual(['l1', 'l2', 'l3']);
    fireEvent.click(within(tools.getByRole('group', { name: '时间方案 A' })).getByRole('button', { name: '采用 A' }));
    expect(data().rewriteLines.map((line: { id: string }) => line.id)).toEqual(['l1', 'l2', 'l3']);
  });
});

describe('导演工具：间隔与标记', () => {
  it('新增、选择并移除画面标记', () => {
    const tools = open();
    tab(tools, '间隔与标记');
    fireEvent.change(tools.getByLabelText('画面标记名称'), { target: { value: '转场' } });
    fireEvent.click(tools.getByRole('button', { name: '标记当前帧' }));
    expect(data().directorEdit.markers).toMatchObject([{ label: '转场', ms: 0 }]);
    expect((tools.getByLabelText('画面标记') as HTMLSelectElement).value).toBe(data().directorEdit.markers[0].id);
    fireEvent.click(tools.getByRole('button', { name: '移除标记' }));
    expect(data().directorEdit.markers).toEqual([]);
  });

  it('首句没有句间停顿可调', () => {
    const tools = open();
    tab(tools, '间隔与标记');
    selectLine('第一句解说');
    expect(tools.getByText('选中第二句或后面的台词，即可调整它和上一句之间的停顿。')).toBeTruthy();
  });

  it('调整句间停顿只移动本句或连同后续', () => {
    const tools = open();
    tab(tools, '间隔与标记');
    selectLine('第二句解说');
    fireEvent.change(tools.getByLabelText('句间停顿毫秒'), { target: { value: '800' } });
    fireEvent.click(tools.getByRole('button', { name: '应用间隔' }));
    const moved = data().rewriteLines.find((line: { id: string }) => line.id === 'l2');
    expect(moved.videoStartMs).toBe(2300);
    expect(data().rewriteLines.find((line: { id: string }) => line.id === 'l3').videoStartMs).toBe(4000);
    fireEvent.change(tools.getByLabelText('停顿影响范围'), { target: { value: 'following' } });
    fireEvent.change(tools.getByLabelText('句间停顿毫秒'), { target: { value: '1000' } });
    fireEvent.click(tools.getByRole('button', { name: '应用间隔' }));
    expect(data().rewriteLines.find((line: { id: string }) => line.id === 'l3').videoStartMs).toBe(4200);
  });
});

describe('导演工具：音量与审阅', () => {
  it('调整总音量并为选区设置音量区间，可删除', () => {
    const tools = open();
    tab(tools, '音量');
    fireEvent.change(tools.getByLabelText(/配音总音量/), { target: { value: '1.5' } });
    expect(data().masterGain).toBe(1.5);
    fireEvent.change(tools.getByLabelText(/原声总音量/), { target: { value: '0.4' } });
    expect(data().directorOriginalGain).toBe(0.4);
    selectLine('第二句解说');
    fireEvent.click(tools.getByRole('button', { name: '应用到选区' }));
    expect(tools.getByText('选区音量已应用，播放与导出会使用该设置。')).toBeTruthy();
    expect(data().directorGainRegions).toMatchObject([{ startMs: 2000, endMs: 3500, track: 'voice', gain: 0.5, fadeMs: 200 }]);
    fireEvent.click(tools.getByRole('button', { name: '复制音量和渐变' }));
    selectLine('第三句解说');
    fireEvent.click(tools.getByRole('button', { name: '粘贴到选区' }));
    expect(data().directorGainRegions).toHaveLength(2);
    fireEvent.click(tools.getByRole('button', { name: '移除 2.00 秒 的音量调整' }));
    expect(data().directorGainRegions).toHaveLength(1);
  });

  it('渐变时长非法时拒绝应用', () => {
    const tools = open();
    tab(tools, '音量');
    selectLine('第二句解说');
    fireEvent.change(tools.getByLabelText(/前后渐变/), { target: { value: '-1' } });
    fireEvent.click(tools.getByRole('button', { name: '应用到选区' }));
    expect(tools.getByText('请选中区间并填写有效的音量与渐变时长。')).toBeTruthy();
  });

  it('为选区添加时间批注', () => {
    const tools = open();
    tab(tools, '审阅');
    selectLine('第一句解说');
    fireEvent.change(tools.getByLabelText('审阅批注'), { target: { value: '语气再轻一点' } });
    fireEvent.click(tools.getByRole('button', { name: '添加时间批注' }));
    expect(data().directorEdit.notes).toMatchObject([{ text: '语气再轻一点', range: { startMs: 0, endMs: 1500 } }]);
    expect(tools.getByText('语气再轻一点', { exact: false })).toBeTruthy();
  });
});
