// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardPackNode } from '@bezier/canvas-card-sdk';
import { DirectorCard } from '../src/director/card';
import { defaultZoom } from '../src/director/workbench';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) { this.removeAttribute('open'); };
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
  Element.prototype.scrollIntoView ??= vi.fn();
  Element.prototype.scrollTo ??= vi.fn() as never;
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

/** 模拟画布：onPatch 合并到节点后回传给卡片。 */
let latest: CardPackNode | null = null;
function Host({ initial, onPatchSpy }: { initial: Record<string, unknown>; onPatchSpy?: (patch: unknown) => void }) {
  const [node, setNode] = useState<CardPackNode>({ id: 'drama-1', kind: 'card.drama.audio', x: 0, y: 0, data: initial });
  latest = node;
  return <DirectorCard node={node} selected onPatch={patch => {
    onPatchSpy?.(patch);
    setNode(current => ({ ...current, ...patch, data: { ...(current.data ?? {}), ...(patch.data ?? {}) } }));
  }} />;
}

function open(data: Record<string, unknown> = { videoDurationMs: 5000, rewriteLines: lines }, onPatchSpy?: (patch: unknown) => void) {
  const view = render(<Host initial={data} {...(onPatchSpy ? { onPatchSpy } : {})} />);
  fireEvent.click(screen.getByRole('button', { name: '打开短剧配音编辑器' }));
  return view;
}

const list = () => within(screen.getByRole('complementary', { name: '台词列表' }));
const inspector = () => within(screen.getByRole('complementary', { name: '内容编辑' }));
const row = (text: string) => list().getByText(text).closest('button')!;
const saveStatus = () => document.querySelector('[data-save-state]')!;
const menu = () => { fireEvent.click(screen.getByRole('button', { name: '更多操作' })); return within(screen.getByRole('menu', { name: '更多操作' })); };
const fileInput = (accept: string) => document.querySelector<HTMLInputElement>(`input[accept="${accept}"]`)!;

describe('编辑器布局', () => {
  it('没有视频和台词时显示引导页', () => {
    open({});
    const start = within(screen.getByRole('region', { name: '开始编辑' }));
    expect(start.getByRole('heading', { name: '开始一段短剧配音' })).toBeTruthy();
    expect(start.getByRole('button', { name: '导入视频' })).toBeTruthy();
    expect(start.getByRole('button', { name: '导入台词' })).toBeTruthy();
    expect((screen.getByRole('button', { name: '导出' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('complementary', { name: '台词列表' })).toBeNull();
  });

  it('台词列表显示进度和每句状态', () => {
    open({ videoDurationMs: 5000, rewriteLines: lines, confirmedLineIds: ['l2'], audioRef: 'session/voice/full.wav',
      segments: [{ id: 'l1', label: '第一句解说', startMs: 0, endMs: 1200, gapMs: 0, gain: 1, muted: false, videoStartMs: 0, videoEndMs: 1500 }],
      generatedLineTexts: { l1: '第一句解说' }, generatedLineVoices: { l1: '自然清晰的普通话解说' } });
    expect(list().getByText('2 句 · 配音 1/2 · 待确认 1')).toBeTruthy();
    expect(row('第二句解说').querySelector('[data-confirmed="true"]')).toBeTruthy();
    expect(row('第二句解说').querySelector('[data-state="missing"]')).toBeTruthy();
    expect(row('第一句解说').querySelector('[data-state]')?.getAttribute('data-state')).toBe('voiced');
  });

  it('有台词但视频需重新选择时提示恢复', () => {
    open({ videoRef: 'card-assets/drama-audio/session/abc/episode.mp4', videoDurationMs: 5000, rewriteLines: lines });
    expect(screen.getByText('刷新后需要重新选择原视频')).toBeTruthy();
    expect(screen.getByRole('button', { name: '选择原文件恢复' })).toBeTruthy();
  });

  it('从台词列表选句后在右侧编辑，并能换句', () => {
    open();
    expect(inspector().getByRole('heading', { name: '选一句开始编辑' })).toBeTruthy();
    fireEvent.click(inspector().getByRole('button', { name: '编辑第一句' }));
    expect(inspector().getByRole('heading', { name: '第 1 句' })).toBeTruthy();
    fireEvent.click(row('第二句解说'));
    expect(inspector().getByRole('heading', { name: '第 2 句' })).toBeTruthy();
    expect(row('第二句解说').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(inspector().getByRole('button', { name: '上一句' }));
    expect(inspector().getByRole('heading', { name: '第 1 句' })).toBeTruthy();
  });
});

describe('编辑与保存', () => {
  it('修改台词后经画布回传显示已保存，撤销和重做恢复内容', () => {
    const spy = vi.fn();
    open(undefined, spy);
    fireEvent.click(row('第一句解说'));
    fireEvent.change(inspector().getByLabelText('台词内容'), { target: { value: '改写后的第一句' } });
    expect(spy).toHaveBeenCalled();
    expect(saveStatus().getAttribute('data-save-state')).toBe('synced');
    expect(saveStatus().textContent).toBe('已保存');
    expect(saveStatus().getAttribute('title')).toBe('已保存到画布');
    expect(list().getByText('改写后的第一句')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(list().getByText('第一句解说')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(list().getByText('改写后的第一句')).toBeTruthy();
  });

  it('键盘 Ctrl+Z 撤销，输入框内不拦截', () => {
    open();
    fireEvent.click(row('第一句解说'));
    const textarea = inspector().getByLabelText('台词内容');
    fireEvent.change(textarea, { target: { value: '临时修改' } });
    fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true });
    expect(list().getByText('临时修改')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('main'), { key: 'z', ctrlKey: true });
    expect(list().getByText('第一句解说')).toBeTruthy();
  });

  it('确认这句后列表标记已确认', () => {
    open();
    fireEvent.click(row('第一句解说'));
    fireEvent.click(inspector().getByRole('button', { name: '确认这句' }));
    expect(row('第一句解说').querySelector('[data-confirmed="true"]')).toBeTruthy();
  });

  it('从菜单导入台词需确认，确认后替换列表；取消则保持不变', async () => {
    open();
    const input = fileInput('.txt,.md,text/plain');
    const clicked = vi.spyOn(input, 'click').mockImplementation(() => {});
    fireEvent.click(menu().getByRole('menuitem', { name: '导入台词' }));
    expect(clicked).toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    const file = new File(['新台词一\n新台词二\n新台词三'], 'script.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: '确认当前操作' })).getByRole('button', { name: '取消' }));
    expect(list().getByText('第一句解说')).toBeTruthy();
    await act(async () => {});
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '确认导入' }));
    expect(await list().findByText('新台词三')).toBeTruthy();
    expect(screen.getByText('台词已进入逐句列表，请检查建议区间。')).toBeTruthy();
  });

  it('拖入台词文件即可导入', async () => {
    open({ videoDurationMs: 5000 });
    const file = new File(['拖入的第一句\n拖入的第二句'], 'drop.txt', { type: 'text/plain' });
    fireEvent.drop(screen.getByRole('main'), { dataTransfer: { files: [file], types: ['Files'] } });
    expect(await screen.findByText('台词已进入逐句列表，请检查建议区间。')).toBeTruthy();
    expect(list().getByText('拖入的第二句')).toBeTruthy();
    expect(list().getByText(/^2 句 · 配音/)).toBeTruthy();
  });

  it('不支持的拖入文件给出提示', () => {
    open({ videoDurationMs: 5000 });
    fireEvent.drop(screen.getByRole('main'), { dataTransfer: { files: [new File(['x'], 'a.bin', { type: 'application/octet-stream' })], types: ['Files'] } });
    expect(screen.getByText('请拖入视频、音频，或 TXT/MD 台词文件。')).toBeTruthy();
  });

  it('台词文件超过 100 KB 时拒绝导入', async () => {
    open();
    fireEvent.change(fileInput('.txt,.md,text/plain'), { target: { files: [new File(['x'.repeat(100_001)], 'big.txt')] } });
    expect(await screen.findByText('台词文件不得超过 100 KB。')).toBeTruthy();
  });
});

describe('时间轴剪辑', () => {
  it('复制已配音片段，粘贴到占用位置被拒绝，删除片段可撤销', () => {
    open({ videoDurationMs: 5000, rewriteLines: lines, audioRef: 'session/voice/full.wav',
      segments: [{ id: 'l2', label: '第二句解说', startMs: 0, endMs: 1400, gapMs: 0, gain: 1, muted: false, videoStartMs: 2000, videoEndMs: 3500 }] });
    fireEvent.click(row('第一句解说'));
    fireEvent.click(screen.getAllByRole('button', { name: /复制/ })[0]!);
    expect(screen.getByText('请先选择已绑定音频的台词。')).toBeTruthy();
    fireEvent.click(row('第二句解说'));
    fireEvent.click(screen.getAllByRole('button', { name: /复制/ })[0]!);
    expect(screen.getByText('已复制片段；将播放头移到空白区间后粘贴。')).toBeTruthy();
    const before = list().getAllByRole('button').length;
    fireEvent.click(screen.getAllByRole('button', { name: /粘贴/ })[0]!);
    expect(list().getAllByRole('button')).toHaveLength(before);
    fireEvent.click(screen.getAllByRole('button', { name: /删除/ })[0]!);
    expect(list().queryByText('第二句解说')).toBeNull();
    expect(screen.getByText('片段已移除，原音频文件保留，可撤销。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(list().getByText('第二句解说')).toBeTruthy();
  });

  it('播放头不在片段内时分割给出提示', () => {
    open();
    fireEvent.click(row('第二句解说'));
    fireEvent.keyDown(screen.getByRole('main'), { key: 's' });
    expect(screen.getByText('请先把播放头放在当前片段内部，再分割。')).toBeTruthy();
  });

  it('未选句时快捷操作提示先选择', () => {
    open();
    fireEvent.keyDown(screen.getByRole('main'), { key: 'Delete' });
    expect(screen.getByText('请先选择一句台词或配音片段。')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('main'), { key: 'v', ctrlKey: true });
    expect(screen.getByText('请先复制当前工程里的片段。')).toBeTruthy();
  });

  it('时间轴视图、缩放、吸附和轨道检查器可切换', () => {
    open();
    fireEvent.click(row('第一句解说'));
    fireEvent.click(screen.getByRole('button', { name: '当前句放大' }));
    fireEvent.click(screen.getByRole('button', { name: '全片概览' }));
    fireEvent.change(screen.getByLabelText('音轨缩放'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: '跟随播放' }));
    fireEvent.click(screen.getByRole('button', { name: /吸附/ }));
    fireEvent.click(screen.getByRole('button', { name: '视频 / 原声' }));
    expect(inspector().getByText('音轨属性')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '配音音轨' }));
    expect(screen.getByRole('button', { name: '配音音轨' }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('导出与菜单', () => {
  it('导出弹窗列出检查项，点击直接下载 SRT', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    const dialog = within(screen.getByRole('dialog', { name: '导出成品' }));
    expect(dialog.getByText('2 句区间未确认')).toBeTruthy();
    fireEvent.click(dialog.getByRole('button', { name: '导出台词 SRT' }));
    expect(await dialog.findByText('短剧台词.srt 已生成。')).toBeTruthy();
    expect(downloads).toEqual(['短剧台词.srt']);
  });

  it('Esc 只关闭导出弹窗，不关闭编辑器', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    expect(screen.getByRole('dialog', { name: '导出成品' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '导出成品' })).toBeNull();
    expect(screen.getByRole('dialog', { name: '短剧配音编辑器' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭导出' }));
    expect(screen.queryByRole('dialog', { name: '导出成品' })).toBeNull();
  });

  it('全部确认后导出弹窗显示无问题', () => {
    open({ videoDurationMs: 5000, rewriteLines: [lines[0]], confirmedLineIds: ['l1'], audioRef: 'session/voice/full.wav',
      segments: [{ id: 'l1', label: '第一句解说', startMs: 0, endMs: 1200, gapMs: 0, gain: 1, muted: false, videoStartMs: 0, videoEndMs: 1500 }],
      generatedLineTexts: { l1: '第一句解说' }, generatedLineVoices: { l1: '自然清晰的普通话解说' } });
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    expect(screen.getByText('检查未发现问题')).toBeTruthy();
  });

  it('更多菜单切换快捷键、主题，Esc 关闭菜单', () => {
    open();
    fireEvent.click(menu().getByRole('menuitem', { name: '快捷键' }));
    expect(screen.getByText(/空格 播放\/暂停/)).toBeTruthy();
    const main = screen.getByRole('main');
    expect(main.getAttribute('data-theme')).toBe('light');
    fireEvent.click(menu().getByRole('menuitem', { name: '切换到深色模式' }));
    expect(main.getAttribute('data-theme')).toBe('dark');
    menu();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('dialog', { name: '短剧配音编辑器' })).toBeTruthy();
  });

  it('使用帮助可搜索并关闭', () => {
    open();
    fireEvent.click(menu().getByRole('menuitem', { name: '使用帮助' }));
    const help = screen.getByRole('dialog', { name: '使用帮助' });
    fireEvent.change(within(help).getByRole('searchbox'), { target: { value: '导出' } });
    fireEvent.click(within(help).getByRole('button', { name: '关闭使用帮助' }));
    expect(screen.queryByRole('dialog', { name: '使用帮助' })).toBeNull();
  });

  it('返回画布关闭编辑器', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: '返回画布' }));
    expect(screen.queryByRole('dialog', { name: '短剧配音编辑器' })).toBeNull();
    expect(screen.getByRole('button', { name: '打开短剧配音编辑器' })).toBeTruthy();
  });
});

describe('配音排布与贴合', () => {
  const take = (id: string, audioMs: number, window: [number, number]) => ({ id, label: id, startMs: 0, endMs: audioMs, gapMs: 0, gain: 1, muted: false, videoStartMs: window[0], videoEndMs: window[1], audioRefOverride: `session/voice/${id}.wav` });
  const voiced = () => ({ videoDurationMs: 5000, rewriteLines: lines, audioRef: null,
    segments: [take('l1', 2200, [0, 1500]), take('l2', 1000, [2000, 3500])],
    generatedLineTexts: { l1: '第一句解说', l2: '第二句解说' }, generatedLineVoices: { l1: '自然清晰的普通话解说', l2: '自然清晰的普通话解说' } });
  const data = () => latest?.data as Record<string, any>;
  const windows = () => (data().rewriteLines as { videoStartMs: number; videoEndMs: number }[]).map(line => [line.videoStartMs, line.videoEndMs]);

  it('超出区间的句子标红，贴合视频后按配音时长连贯排布', () => {
    open(voiced());
    expect(row('第一句解说').querySelector('[data-state]')?.getAttribute('data-state')).toBe('over');
    fireEvent.click(screen.getByRole('button', { name: '贴合视频' }));
    expect(windows()[0]).toEqual([0, 2200]);
    expect(windows()[1]![0]).toBeGreaterThan(2200);
    expect(screen.getByText(/配音排到 .* \/ 视频 0:05/u)).toBeTruthy();
    expect(row('第一句解说').querySelector('[data-state]')?.getAttribute('data-state')).toBe('voiced');
  });

  it('设置与上一句重叠，配音提前进入且字幕区间不重叠', () => {
    open(voiced());
    fireEvent.click(row('第二句解说'));
    const field = screen.getByLabelText('与上一句的间隔（毫秒）');
    fireEvent.change(field, { target: { value: '-300' } });
    fireEvent.blur(field);
    expect(data().lineJoins).toEqual({ l2: -300 });
    const l2 = (data().segments as { id: string; leadMs?: number }[]).find(item => item.id === 'l2');
    expect(l2?.leadMs).toBe(300);
    expect(windows()[1]![0]).toBe(windows()[0]![1]);
    expect(screen.getByText('重叠')).toBeTruthy();
    expect(document.querySelector('[data-preview-line-id="l2"] [title="与上一句重叠 300 ms"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '恢复自动' }));
    expect(data().lineJoins).toEqual({});
  });

  it('配音放不下时自动加速并在片段上显示倍率', () => {
    open({ ...voiced(), videoDurationMs: 3000, segments: [take('l1', 2000, [0, 1500]), take('l2', 1100, [2000, 3000])] });
    fireEvent.click(screen.getByRole('button', { name: '贴合视频' }));
    const speeds = (data().segments as { fitSpeed?: number }[]).map(item => item.fitSpeed);
    expect(speeds.every(speed => speed !== undefined && speed > 1)).toBe(true);
    expect(screen.getByText(/2 句加速至 1\.\d\d×/u)).toBeTruthy();
    expect(document.querySelector('[data-preview-line-id="l1"]')?.textContent).toMatch(/1\.\d\d×/u);
  });

  it('调整语速后自动重新贴合', () => {
    open(voiced());
    fireEvent.click(row('第一句解说'));
    const speed = screen.getByLabelText('本句语速');
    fireEvent.change(speed, { target: { value: '110' } });
    fireEvent.blur(speed);
    expect(windows()[0]).toEqual([0, Math.round(2200 / 1.1)]);
  });

  it('配音长度变化后自动重新贴合，关闭自动后不再移动', () => {
    open(voiced());
    fireEvent.click(row('第一句解说'));
    const out = screen.getByLabelText('音频出点（毫秒）');
    fireEvent.change(out, { target: { value: '1200' } });
    fireEvent.blur(out);
    expect(windows()[0]).toEqual([0, 1200]);
    expect(screen.getByText(/配音排到/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '自动' }));
    expect(screen.getByRole('button', { name: '自动' }).getAttribute('aria-pressed')).toBe('false');
    const before = windows();
    const again = screen.getByLabelText('音频出点（毫秒）');
    fireEvent.change(again, { target: { value: '1000' } });
    fireEvent.blur(again);
    expect(windows()).toEqual(before);
  });
});

describe('时间轴缩放与滚动', () => {
  it('按视频长度选默认缩放，一屏约 20 秒', () => {
    expect(defaultZoom(5000)).toBe(1);
    expect(defaultZoom(45_000)).toBe(2);
    expect(defaultZoom(173_000)).toBe(8);
    expect(defaultZoom(3_600_000)).toBe(32);
  });

  it('长视频打开时自动放大，可手动改缩放', () => {
    open({ videoDurationMs: 173_000, rewriteLines: lines });
    const zoom = screen.getByLabelText('音轨缩放') as HTMLSelectElement;
    expect(zoom.value).toBe('8');
    fireEvent.change(zoom, { target: { value: '2' } });
    expect(zoom.value).toBe('2');
  });

  it('⌘/Ctrl + 滚轮缩放时间轴，普通滚轮在无需滚动时不拦截', () => {
    open();
    const zoom = screen.getByLabelText('音轨缩放') as HTMLSelectElement;
    const viewport = document.querySelector('[class*="timelineViewport"]')!;
    act(() => { viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true })); });
    expect(zoom.value).toBe('2');
    act(() => { viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, metaKey: true, bubbles: true, cancelable: true })); });
    expect(zoom.value).toBe('1');
    const plain = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    viewport.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
  });
});

describe('音色基准与批量更新', () => {
  it('音频未载入的句子显示虚线点，按钮优先重新生成它们', () => {
    open({ videoDurationMs: 5000, rewriteLines: lines, audioRef: null,
      segments: lines.map(line => ({ id: line.id, label: line.text, startMs: 0, endMs: 1000, gapMs: 0, gain: 1, muted: false, videoStartMs: line.videoStartMs, videoEndMs: line.videoEndMs, audioRefOverride: `session/${line.id}.wav` })),
      generatedLineTexts: { l1: '第一句解说', l2: '第二句解说' }, generatedLineVoices: { l1: '温柔女声', l2: '温柔女声' },
      voiceReference: { lineId: 'l1', audioRef: 'session/l1.wav', startMs: 0, endMs: 1000, text: '第一句解说', voice: '温柔女声' } });
    expect(screen.getByRole('button', { name: /重新生成未载入的 2 句/ })).toBeTruthy();
    expect(row('第一句解说').getAttribute('data-offline')).toBe('true');
    expect(row('第二句解说').querySelector('[data-state="stale"]')).toBeTruthy();
    expect(row('第一句解说').querySelector('[data-state="voiced"]')).toBeTruthy();
  });
});
