// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  Element.prototype.scrollTo ??= vi.fn() as never;
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never;
});

let downloads: { name: string; blob: Blob }[] = [];
beforeEach(() => {
  downloads = [];
  URL.createObjectURL = vi.fn(() => 'blob:mock');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
    downloads.push({ name: this.download, blob: new Blob() });
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const lines = [
  { id: 'l1', text: '第一句解说', videoStartMs: 0, videoEndMs: 1500 },
  { id: 'l2', text: '第二句解说', videoStartMs: 2000, videoEndMs: 3500 },
];

/** 模拟画布：onPatch 合并到节点后回传给卡片。 */
function Host({ initial, onPatchSpy }: { initial: Record<string, unknown>; onPatchSpy?: (patch: unknown) => void }) {
  const [node, setNode] = useState<CardPackNode>({ id: 'drama-1', kind: 'card.drama.audio', x: 0, y: 0, data: initial });
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

const transcript = () => within(screen.getByRole('region', { name: '台词浏览' }));
const inspector = () => within(screen.getByRole('complementary', { name: '内容编辑与交付' }));
const saveStatus = () => document.querySelector('[data-save-state]')!;

describe('配音音轨', () => {
  const take = (id: string, window: [number, number]) => ({ id, label: id, startMs: 0, endMs: 1800, gapMs: 0, gain: 1, muted: false, videoStartMs: window[0], videoEndMs: window[1], audioRefOverride: `session/voice/${id}.wav` });
  const touching = [
    { id: 'l1', text: '第一句解说', videoStartMs: 0, videoEndMs: 2000 },
    { id: 'l2', text: '第二句解说', videoStartMs: 2000, videoEndMs: 4000 },
    { id: 'l3', text: '第三句解说', videoStartMs: 4000, videoEndMs: 6000 },
  ];

  it('没有配音的句子不出现在配音音轨上', () => {
    open({ videoDurationMs: 10_000, rewriteLines: touching, segments: [take('l1', [0, 2000])] });
    expect(document.querySelector('[data-preview-line-id="l1"]')).toBeTruthy();
    expect(document.querySelector('[data-preview-line-id="l2"]')).toBeNull();
    expect(transcript().getByText('第二句解说')).toBeTruthy();
  });

  it('拖动整段时相邻句子让位，不再因重叠失败', () => {
    let latest: Record<string, any> = {};
    open({ videoDurationMs: 10_000, rewriteLines: touching, segments: [take('l1', [0, 2000]), take('l2', [2000, 4000])] },
      patch => { latest = { ...latest, ...(patch as { data: Record<string, unknown> }).data }; });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 1000, bottom: 40, width: 1000, height: 40, x: 0, y: 0, toJSON: () => ({}) });
    Element.prototype.setPointerCapture ??= vi.fn();
    const clip = document.querySelector('[data-preview-line-id="l1"]')!;
    fireEvent.pointerDown(clip, { pointerId: 1, isPrimary: true, button: 0, clientX: 500 });
    fireEvent.pointerMove(clip, { pointerId: 1, isPrimary: true, clientX: 550 });
    fireEvent.pointerUp(clip, { pointerId: 1, isPrimary: true, clientX: 550 });
    const windows = (latest.rewriteLines as { id: string; videoStartMs: number; videoEndMs: number }[]).map(line => [line.id, line.videoStartMs, line.videoEndMs]);
    // 第二句有 1.8 秒配音，只能缩到 1.8 秒，于是整体顺延；第三句没有配音，缩短自己的区间让位。
    expect(windows).toEqual([['l1', 500, 2500], ['l2', 2500, 4300], ['l3', 4300, 6000]]);
    expect(screen.getByText(/相邻 2 句已让位/u)).toBeTruthy();
  });
});

describe('左侧素材与批量配音', () => {
  const take = (id: string, window: [number, number]) => ({ id, label: id, startMs: 0, endMs: 1400, gapMs: 0, gain: 1, muted: false, videoStartMs: window[0], videoEndMs: window[1], audioRefOverride: `session/voice/${id}.wav` });
  const voicedData = () => ({ videoDurationMs: 5000, videoRef: 'session/video.mp4', rewriteLines: lines, segments: [take('l1', [0, 1500])],
    generatedLineTexts: { l1: '第一句解说' }, generatedLineVoices: { l1: '自然清晰的普通话解说' } });
  const imports = () => document.querySelector('details[class*="assetImports"]') as HTMLDetailsElement;

  it('视频和台词都导入后，导入区默认收起；没有素材时展开', () => {
    open(voicedData());
    expect(imports().open).toBe(false);
    cleanup();
    open({});
    expect(imports().open).toBe(true);
  });

  it('补齐配音不在导入区，而是放在台词列表标题旁，并显示缺几句', () => {
    open(voicedData());
    expect(within(imports()).queryByRole('button', { name: /补齐/ })).toBeNull();
    const bar = within(screen.getByLabelText('批量配音'));
    expect(bar.getByRole('button', { name: '补齐缺失配音（1 句）' })).toBeTruthy();
    expect(screen.queryByText('画面采样与改写')).toBeNull();
    expect(screen.queryByRole('button', { name: '打开画布主文件' })).toBeNull();
  });

  it('批量配音前可以先选整体音色', () => {
    let latest: Record<string, unknown> = {};
    open(voicedData(), patch => { latest = { ...latest, ...(patch as { data: Record<string, unknown> }).data }; });
    const select = within(screen.getByLabelText('批量配音')).getByRole('combobox');
    fireEvent.change(select, { target: { value: '温柔亲切的女声，语速平缓' } });
    expect(latest.voiceInstruction).toBe('温柔亲切的女声，语速平缓');
    expect(within(screen.getByLabelText('批量配音')).getByRole('button', { name: '补齐缺失配音（1 句）' })).toBeTruthy();
  });

  it('把一句设为音色基准后，其他句子跟随它，批量按钮提示更新', () => {
    open(voicedData());
    fireEvent.click(transcript().getByText('第一句解说').closest('button')!);
    fireEvent.click(inspector().getByRole('button', { name: '设为音色基准' }));
    expect(inspector().getByText('这句是音色基准，其他句子会按它的声音生成')).toBeTruthy();
    const bar = within(screen.getByLabelText('批量配音'));
    expect(bar.getByText(/按第 1 句的声音/u)).toBeTruthy();
    fireEvent.click(transcript().getByText('第二句解说').closest('button')!);
    const voice = [...document.querySelectorAll('label')].find(label => label.textContent?.startsWith('本句音色'))!.querySelector('select')!;
    expect(voice.options[voice.selectedIndex]!.textContent).toBe('跟随第 1 句的音色');
    fireEvent.click(bar.getByRole('button', { name: '取消基准' }));
    expect(within(screen.getByLabelText('批量配音')).getByRole('combobox')).toBeTruthy();
  });
});

describe('画布保存有往返延迟', () => {
  afterEach(() => { vi.useRealTimers(); });
  /** 像真实画布一样：每次修改经服务端往返后才回传。 */
  function SlowHost({ delay, onNode }: { delay: number; onNode: (node: CardPackNode) => void }) {
    const [node, setNode] = useState<CardPackNode>({ id: 'drama-1', kind: 'card.drama.audio', x: 0, y: 0, data: { videoDurationMs: 5000, rewriteLines: lines } });
    onNode(node);
    return <DirectorCard node={node} selected onPatch={patch => {
      setTimeout(() => setNode(current => ({ ...current, data: { ...(current.data ?? {}), ...(patch.data ?? {}) } })), delay);
    }} />;
  }

  it('连续输入时台词立即显示，切到下一句后上一句的修改仍然保存', async () => {
    vi.useFakeTimers();
    let latest: CardPackNode | null = null;
    render(<SlowHost delay={300} onNode={node => { latest = node; }} />);
    fireEvent.click(screen.getByRole('button', { name: '打开短剧配音编辑器' }));
    fireEvent.click(transcript().getByText('第一句解说').closest('button')!);
    const box = () => inspector().getByLabelText('台词内容') as HTMLTextAreaElement;
    for (const value of ['第一句解说A', '第一句解说AB', '第一句解说ABC']) {
      fireEvent.change(box(), { target: { value } });
      await act(async () => { vi.advanceTimersByTime(120); });
      expect(box().value).toBe(value);
    }
    expect(transcript().getByText('第一句解说ABC')).toBeTruthy();
    fireEvent.click(transcript().getByText('第二句解说').closest('button')!);
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect((latest!.data!.rewriteLines as { text: string }[])[0]!.text).toBe('第一句解说ABC');
    expect(saveStatus().getAttribute('data-save-state')).toBe('synced');
    fireEvent.click(transcript().getByText('第一句解说ABC').closest('button')!);
    expect(box().value).toBe('第一句解说ABC');
  });
});

describe('音频工作台交互', () => {
  it('从台词列表选句后在右侧编辑，并能换句', () => {
    open();
    expect(inspector().getByText('选中要修改的内容')).toBeTruthy();
    fireEvent.click(inspector().getByRole('button', { name: '编辑第一句' }));
    expect(inspector().getByRole('heading', { name: '第 1 句' })).toBeTruthy();
    fireEvent.click(transcript().getByText('第二句解说').closest('button')!);
    expect(inspector().getByRole('heading', { name: '第 2 句' })).toBeTruthy();
    expect(transcript().getByText('第二句解说').closest('button')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('修改台词后经画布回传显示已保存，撤销和重做恢复内容', () => {
    const spy = vi.fn();
    open(undefined, spy);
    fireEvent.click(transcript().getByText('第一句解说').closest('button')!);
    const textarea = inspector().getByLabelText('台词内容') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '改写后的第一句' } });
    expect(spy).toHaveBeenCalled();
    expect(saveStatus().getAttribute('data-save-state')).toBe('synced');
    expect(saveStatus().textContent).toBe('已保存到画布');
    expect(transcript().getByText('改写后的第一句')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(transcript().getByText('第一句解说')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(transcript().getByText('改写后的第一句')).toBeTruthy();
  });

  it('键盘 Ctrl+Z 撤销，输入框内不拦截', () => {
    open();
    fireEvent.click(transcript().getByText('第一句解说').closest('button')!);
    const textarea = inspector().getByLabelText('台词内容');
    fireEvent.change(textarea, { target: { value: '临时修改' } });
    fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true });
    expect(transcript().getByText('临时修改')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('main'), { key: 'z', ctrlKey: true });
    expect(transcript().getByText('第一句解说')).toBeTruthy();
  });

  it('确认本句区间后更新状态与检查项', () => {
    open();
    fireEvent.click(screen.getAllByRole('button', { name: /^检查/ })[0]!);
    expect(inspector().getByText('2 句区间未确认', { exact: false })).toBeTruthy();
    fireEvent.click(inspector().getByRole('button', { name: '查看台词并处理' }));
    fireEvent.click(transcript().getByText('第一句解说').closest('button')!);
    fireEvent.click(inspector().getByRole('button', { name: '确认本句区间' }));
    expect(transcript().getByText('第一句解说').closest('button')!.querySelector('[data-confirmed="true"]')).toBeTruthy();
  });

  it('导入台词需确认，确认后替换列表；取消则保持不变', async () => {
    const { container } = open();
    const input = container.ownerDocument.querySelector<HTMLInputElement>('input[accept=".txt,.md,text/plain"]')!;
    const file = new File(['新台词一\n新台词二\n新台词三'], 'script.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    const dialog = await screen.findByRole('alertdialog', { name: '确认当前操作' });
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(transcript().getByText('第一句解说')).toBeTruthy();
    await act(async () => {});
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '确认导入' }));
    expect(await transcript().findByText('新台词三')).toBeTruthy();
    expect(screen.getByText('台词已进入逐句列表，请检查建议区间。')).toBeTruthy();
  });

  it('台词文件超过 100 KB 时拒绝导入', async () => {
    const { container } = open();
    const input = container.ownerDocument.querySelector<HTMLInputElement>('input[accept=".txt,.md,text/plain"]')!;
    fireEvent.change(input, { target: { files: [new File(['x'.repeat(100_001)], 'big.txt')] } });
    expect(await screen.findByText('台词文件不得超过 100 KB。')).toBeTruthy();
  });

  it('复制已配音片段，粘贴到占用位置被拒绝，删除片段可撤销', () => {
    open({ videoDurationMs: 5000, rewriteLines: lines, audioRef: 'session/voice/full.wav',
      segments: [{ id: 'l2', label: '第二句解说', startMs: 0, endMs: 1400, gapMs: 0, gain: 1, muted: false, videoStartMs: 2000, videoEndMs: 3500 }] });
    fireEvent.click(transcript().getByText('第一句解说').closest('button')!);
    fireEvent.click(screen.getAllByRole('button', { name: /复制/ })[0]!);
    expect(screen.getByText('请先选择已绑定音频的台词。')).toBeTruthy();
    fireEvent.click(transcript().getByText('第二句解说').closest('button')!);
    fireEvent.click(screen.getAllByRole('button', { name: /复制/ })[0]!);
    expect(screen.getByText('已复制片段；将播放头移到空白区间后粘贴。')).toBeTruthy();
    const before = transcript().getAllByRole('button').length;
    fireEvent.click(screen.getAllByRole('button', { name: /粘贴/ })[0]!);
    expect(transcript().getAllByRole('button')).toHaveLength(before);
    fireEvent.click(screen.getAllByRole('button', { name: /删除/ })[0]!);
    expect(transcript().queryByText('第二句解说')).toBeNull();
    expect(screen.getByText('片段已移除，原音频文件保留，可撤销。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(transcript().getByText('第二句解说')).toBeTruthy();
  });

  it('播放头不在片段内时分割给出提示', () => {
    open();
    fireEvent.click(transcript().getByText('第二句解说').closest('button')!);
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

  it('导出 SRT 先提示检查项，确认后下载', async () => {
    open();
    fireEvent.click(screen.getAllByRole('button', { name: '导出' })[0]!);
    fireEvent.click(inspector().getByRole('button', { name: '导出台词 SRT' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: '继续导出' }));
    expect(await screen.findByText('短剧台词.srt 已生成。')).toBeTruthy();
    expect(downloads.map(item => item.name)).toEqual(['短剧台词.srt']);
  });

  it('取消导出检查时不下载', async () => {
    open();
    fireEvent.click(screen.getAllByRole('button', { name: '导出' })[0]!);
    fireEvent.click(inspector().getByRole('button', { name: '导出台词 SRT' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await act(async () => {});
    expect(downloads).toHaveLength(0);
  });

  it('主题、侧栏和轨道检查器可切换，已移除的工作区预设和轨高不再出现', () => {
    open();
    for (const name of ['快捷键', '台词精修', '音频剪辑', '混音检查', '重置布局']) expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByLabelText('音轨高度')).toBeNull();
    const main = screen.getByRole('main');
    expect(main.getAttribute('data-theme')).toBe('dark');
    fireEvent.click(screen.getByRole('button', { name: '切换到浅色模式' }));
    expect(main.getAttribute('data-theme')).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: '收起左侧栏' }));
    expect(screen.getByRole('button', { name: '展开素材' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '展开左侧栏' }));
    fireEvent.click(screen.getByRole('button', { name: '视频 / 原声' }));
    fireEvent.click(screen.getByRole('button', { name: '配音音轨' }));
    fireEvent.change(screen.getByLabelText('音轨缩放'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: '跟随播放' }));
    fireEvent.click(screen.getByRole('button', { name: /吸附/ }));
    fireEvent.click(screen.getByRole('button', { name: '全片概览' }));
  });

  it('使用帮助可搜索并关闭', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: '使用帮助' }));
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

  it('没有台词时引导导入素材', () => {
    open({});
    expect(transcript().getByText('导入台词后，可在这里逐句浏览和编辑。')).toBeTruthy();
    expect(screen.getByText('暂无视频')).toBeTruthy();
    expect((inspector().getByRole('button', { name: '编辑第一句' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
