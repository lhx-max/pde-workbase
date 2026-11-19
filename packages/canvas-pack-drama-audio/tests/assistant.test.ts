import { describe, expect, it } from 'vitest';
import { describeCommand, parseCommand, parseNumber, planIntents } from '../src/director/assistant';
import type { AssistantContext, AssistantIntent } from '../src/director/assistant';

const context: AssistantContext = {
  lines: Array.from({ length: 6 }, (_, i) => ({ id: `l${i + 1}`, text: `第${i + 1}句台词` })),
  selectedId: null,
};
const intents = (text: string, ctx = context) => {
  const result = parseCommand(text, ctx);
  if ('error' in result) throw new Error(result.error);
  return result.intents;
};
const errorOf = (text: string, ctx = context) => {
  const result = parseCommand(text, ctx);
  return 'error' in result ? result.error : null;
};
const segment = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: id, startMs: 0, endMs: 1000, gapMs: 0, gain: 1, muted: false, videoStartMs: 0, videoEndMs: 1000, audioRefOverride: `voice/${id}.wav`, ...extra });
const data = () => ({
  rewriteLines: context.lines.map((line, i) => ({ ...line, videoStartMs: i * 2000, videoEndMs: i * 2000 + 1500 })),
  segments: [segment('l1', { speed: 1.2 }), segment('l2'), segment('l3', { speed: 1.2 }), segment('l4')],
  confirmedLineIds: ['l2'],
  generatedLineVoices: { l1: '温柔女声' },
});

describe('数字与句子引用', () => {
  it.each([['3', 3], ['十二', 12], ['二十', 20], ['两', 2], ['一百零五', 105], ['0.5', 0.5], ['abc', null], ['', null]])('%s → %s', (raw, value) => {
    expect(parseNumber(raw)).toBe(value);
  });

  it('支持单句、范围、列表、最后一句和当前选中句', () => {
    expect(intents('第三句慢一点')).toEqual([{ op: 'speed', lines: [2], delta: -0.1 }]);
    expect(intents('第2到4句快一点')).toEqual([{ op: 'speed', lines: [1, 2, 3], delta: 0.1 }]);
    expect(intents('第1、3和5句静音')).toEqual([{ op: 'mute', lines: [0, 2, 4], muted: true }]);
    expect(intents('最后一句大声一点')).toEqual([{ op: 'gain', lines: [5], delta: 0.2 }]);
    expect(intents('这句小声一点', { ...context, selectedId: 'l4' })).toEqual([{ op: 'gain', lines: [3], delta: -0.2 }]);
    expect(intents('慢一点', { ...context, selectedId: 'l2' })).toEqual([{ op: 'speed', lines: [1], delta: -0.1 }]);
  });

  it('句子不存在或没指明时给出提示', () => {
    expect(errorOf('第9句慢一点')).toContain('当前共有 6 句');
    expect(errorOf('慢一点')).toContain('第几句');
    expect(errorOf('第1句慢一点', { lines: [], selectedId: null })).toContain('请先导入台词');
    expect(errorOf('今天天气不错')).toContain('没听懂');
    expect(errorOf('  ')).toContain('请输入');
  });
});

describe('指令解析', () => {
  it('一句话里的多个要求沿用同一句，重复表达只算一次', () => {
    expect(intents('第 3 句太赶了，慢一点，后面停半秒')).toEqual([
      { op: 'speed', lines: [2], delta: -0.1 },
      { op: 'join', lines: [3], ms: 500 },
    ]);
  });

  it('停顿、重叠与紧凑', () => {
    expect(intents('第5句后面停顿一秒半')).toEqual([{ op: 'join', lines: [5], ms: 1500 }]);
    expect(intents('第3、4句间隔500ms')).toEqual([{ op: 'join', lines: [3], ms: 500 }]);
    expect(intents('第4句前面空0.3秒')).toEqual([{ op: 'join', lines: [3], ms: 300 }]);
    expect(intents('第2句和上一句重叠200毫秒')).toEqual([{ op: 'join', lines: [1], ms: -200 }]);
    expect(intents('第2句接上，不要停顿')).toEqual([{ op: 'join', lines: [1], ms: 0 }]);
    expect(intents('第2句停一下')).toEqual([{ op: 'join', lines: [1], ms: 500 }]);
    expect(intents('第2句恢复自动间隔')).toEqual([{ op: 'join', lines: [1], ms: null }]);
  });

  it('语速与音量的具体数值', () => {
    expect(intents('第1句语速110%')).toEqual([{ op: 'speed', lines: [0], value: 1.1 }]);
    expect(intents('第1句1.2倍速')).toEqual([{ op: 'speed', lines: [0], value: 1.2 }]);
    expect(intents('第1句恢复语速')).toEqual([{ op: 'speed', lines: [0], value: 1 }]);
    expect(intents('第1句太慢了')).toEqual([{ op: 'speed', lines: [0], delta: 0.1 }]);
    expect(intents('第2句音量80%')).toEqual([{ op: 'gain', lines: [1], value: 0.8 }]);
    expect(intents('第2句取消静音')).toEqual([{ op: 'mute', lines: [1], muted: false }]);
  });

  it('改台词时保留标点', () => {
    expect(intents('把第2句改成「你好，世界。」')).toEqual([{ op: 'text', line: 1, text: '你好，世界。' }]);
    expect(intents('第二句台词改为：她终于回来了，带着复仇的决心')).toEqual([{ op: 'text', line: 1, text: '她终于回来了，带着复仇的决心' }]);
    expect(errorOf('把第20句改成你好')).toContain('找不到');
  });

  it('音色基准与音色描述', () => {
    expect(intents('用第 1 句的声音统一全部')).toEqual([{ op: 'reference', line: 0 }]);
    expect(intents('第3句设为音色基准')).toEqual([{ op: 'reference', line: 2 }]);
    expect(intents('取消音色基准')).toEqual([{ op: 'reference', line: null }]);
    expect(intents('第3句音色换成低沉男声')).toEqual([{ op: 'voice', lines: [2], instruction: '低沉男声' }]);
    expect(intents('整体音色改成温柔女声')).toEqual([{ op: 'voice', lines: 'all', instruction: '温柔女声' }]);
    expect(intents('音色换成播音腔', { ...context, selectedId: 'l2' })).toEqual([{ op: 'voice', lines: 'all', instruction: '播音腔' }]);
    expect(intents('第3句音色恢复默认')).toEqual([{ op: 'voice', lines: [2], instruction: null }]);
    expect(errorOf('设为音色基准')).toContain('指定一句');
  });

  it('全局命令', () => {
    expect(intents('贴合视频')).toEqual([{ op: 'fit' }]);
    expect(intents('补齐配音')).toEqual([{ op: 'generate' }]);
    expect(intents('检查问题')).toEqual([{ op: 'check' }]);
    expect(intents('撤销')).toEqual([{ op: 'undo' }]);
    expect(intents('导出字幕')).toEqual([{ op: 'export', kind: 'srt' }]);
    expect(intents('导出MP4')).toEqual([{ op: 'export', kind: 'mp4' }]);
    expect(intents('下载交接包')).toEqual([{ op: 'export', kind: 'zip' }]);
    expect(intents('导出音频')).toEqual([{ op: 'export', kind: 'wav' }]);
    expect(intents('跳到第4句')).toEqual([{ op: 'select', line: 3 }]);
    expect(intents('试听第2句')).toEqual([{ op: 'select', line: 1 }, { op: 'play' }]);
    expect(intents('第2句')).toEqual([{ op: 'select', line: 1 }]);
    expect(intents('确认第1到2句')).toEqual([{ op: 'confirm', lines: [0, 1] }]);
  });
});

describe('换算成数据修改', () => {
  const plan = (list: AssistantIntent[]) => planIntents(data(), list, context);

  it('多个修改叠加为一次提交，并标出需要重新贴合', () => {
    const result = plan(intents('第 3 句太赶了，慢一点，后面停半秒'));
    expect(result.steps.map(step => step.label)).toEqual(['第 3 句语速 120% → 110%', '第 3、4 句间隔 → 500 ms']);
    expect(result.retime).toBe(true);
    expect((result.changes.segments as { id: string; speed?: number }[]).find(item => item.id === 'l3')!.speed).toBe(1.1);
    expect(result.changes.lineJoins).toEqual({ l4: 500 });
  });

  it('语速限制在 80%–130%，没有配音的句子跳过并说明', () => {
    const result = plan([{ op: 'speed', lines: [0, 5], value: 2 }]);
    expect((result.changes.segments as { id: string; speed?: number }[])[0]!.speed).toBe(1.3);
    expect(result.notes.join()).toContain('第 6 句还没有配音');
    expect(result.notes.join()).toContain('80%–130%');
    expect(plan([{ op: 'speed', lines: [5], delta: 0.1 }]).steps).toEqual([]);
  });

  it('音量、静音与确认', () => {
    const result = plan([{ op: 'gain', lines: [1], delta: 0.2 }, { op: 'mute', lines: [0], muted: true }, { op: 'confirm', lines: [0, 1] }]);
    expect(result.changes.lineGains).toEqual({ l2: 1.2 });
    const segments = result.changes.segments as { id: string; gain: number; muted: boolean }[];
    expect(segments.find(item => item.id === 'l2')!.gain).toBe(1.2);
    expect(segments.find(item => item.id === 'l1')!.muted).toBe(true);
    expect(result.changes.confirmedLineIds).toEqual(['l2', 'l1']);
    expect(result.steps.map(step => step.label)).toEqual(['第 2 句音量 100% → 120%', '第 1 句静音', '确认第 1–2 句']);
    expect(plan([{ op: 'gain', lines: [0, 2], value: 0.5 }]).steps[0]!.label).toBe('第 1、3 句音量 → 50%');
  });

  it('改台词同步台本并取消这句的确认', () => {
    const result = plan([{ op: 'text', line: 1, text: '新的第二句' }]);
    expect((result.changes.rewriteLines as { text: string }[])[1]!.text).toBe('新的第二句');
    expect(result.changes.script).toContain('新的第二句');
    expect(result.changes.confirmedLineIds).toEqual([]);
    expect(result.notes.join()).toContain('待更新');
  });

  it('音色基准取这句的配音，没有配音时说明原因', () => {
    const result = plan([{ op: 'reference', line: 0 }]);
    expect(result.changes.voiceReference).toEqual({ lineId: 'l1', audioRef: 'voice/l1.wav', startMs: 0, endMs: 1000, text: '第1句台词', voice: '温柔女声' });
    expect(plan([{ op: 'reference', line: 5 }]).notes.join()).toContain('不能作为音色基准');
    expect(plan([{ op: 'reference', line: null }]).changes).toEqual({ voiceReference: null });
  });

  it('逐句与整体音色', () => {
    expect(plan([{ op: 'voice', lines: [2], instruction: '低沉男声' }]).changes).toEqual({ lineVoiceInstructions: { l3: '低沉男声' } });
    expect(plan([{ op: 'voice', lines: 'all', instruction: null }]).steps[0]!.label).toBe('整体音色恢复默认');
  });

  it('第 1 句前面没有衔接，命令单独列出', () => {
    const result = plan([{ op: 'join', lines: [0], ms: 300 }, { op: 'fit' }, { op: 'export', kind: 'srt' }]);
    expect(result.steps).toEqual([]);
    expect(result.notes.join()).toContain('第 1 句前面');
    expect(result.commands.map(command => describeCommand(command, context))).toEqual(['贴合视频', '导出字幕 SRT']);
    expect(describeCommand({ op: 'select', line: 0 }, context)).toBe('跳到第 1 句：第1句台词');
  });
});
