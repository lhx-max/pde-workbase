import { effectiveLineVoice } from '../dubbing';
import type { DramaAudioSegment } from '../types';
import { setJoin } from './layout';

/**
 * 配音助手：把自然语言指令解析成结构化意图，再换算成卡片数据修改。
 * 意图是纯 JSON，以后可以由大模型产出同样的结构，换掉 parseCommand 即可。
 */

type Data = Record<string, unknown>;
export type ExportKind = 'srt' | 'wav' | 'mp4' | 'zip';
export type AssistantIntent =
  | { op: 'speed'; lines: number[]; value?: number; delta?: number }
  | { op: 'gain'; lines: number[]; value?: number; delta?: number }
  | { op: 'mute'; lines: number[]; muted: boolean }
  | { op: 'join'; lines: number[]; ms: number | null }
  | { op: 'text'; line: number; text: string }
  | { op: 'voice'; lines: number[] | 'all'; instruction: string | null }
  | { op: 'reference'; line: number | null }
  | { op: 'confirm'; lines: number[] }
  | { op: 'select'; line: number }
  | { op: 'fit' } | { op: 'generate' } | { op: 'check' } | { op: 'play' } | { op: 'undo' }
  | { op: 'export'; kind: ExportKind };
export type CommandIntent = Extract<AssistantIntent, { op: 'select' | 'fit' | 'generate' | 'check' | 'play' | 'undo' | 'export' }>;
export interface AssistantContext { lines: { id: string; text: string }[]; selectedId: string | null }
export type ParseResult = { intents: AssistantIntent[] } | { error: string };

export const ASSISTANT_EXAMPLES = ['第 3 句慢一点', '第 5 句后面停半秒', '把第 2 句改成……', '用第 1 句的音色统一全部', '贴合视频', '导出字幕'] as const;
const SPEED_RANGE = [0.8, 1.3] as const;
const STEP_SPEED = 0.1;
const STEP_GAIN = 0.2;
const DEFAULT_PAUSE_MS = 500;

const CN = '零〇一二两三四五六七八九十百';
const NUM = `[\\d${CN}]+`;
const DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 阿拉伯数字或中文数字（到百位）。 */
export function parseNumber(raw: string): number | null {
  const text = raw.trim();
  if (/^\d+(?:\.\d+)?$/u.test(text)) return Number(text);
  if (!text || ![...text].every(char => CN.includes(char))) return null;
  let total = 0, digit = 0;
  for (const char of text) {
    if (char === '百') { total += (digit || 1) * 100; digit = 0; }
    else if (char === '十') { total += (digit || 1) * 10; digit = 0; }
    else digit = DIGITS[char]!;
  }
  return total + digit;
}

/** 句子引用：第3句、第3到5句、第3、4句、这句、最后一句、全部。返回 0 起的序号。 */
function lineRefs(clause: string, context: AssistantContext): number[] | 'all' | null {
  const count = context.lines.length;
  const valid = (n: number | null) => n !== null && Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : null;
  const range = new RegExp(`第\\s*(${NUM})\\s*(?:句|行)?\\s*[到至~\\-—]\\s*第?\\s*(${NUM})\\s*[句行]`, 'u').exec(clause);
  if (range) {
    const from = valid(parseNumber(range[1]!)), to = valid(parseNumber(range[2]!));
    if (from === null || to === null) return [];
    return Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => Math.min(from, to) + i);
  }
  const list = new RegExp(`第\\s*(${NUM}(?:\\s*[、，,和与及跟]\\s*第?\\s*${NUM})*)\\s*[句行]`, 'u').exec(clause);
  if (list) {
    const picks = list[1]!.split(/[、，,和与及跟]/u).map(part => valid(parseNumber(part.replace('第', ''))));
    return picks.every(pick => pick !== null) ? [...new Set(picks as number[])] : [];
  }
  if (/最后一句|末句/u.test(clause)) return count ? [count - 1] : [];
  if (/第一句|首句/u.test(clause)) return count ? [0] : [];
  if (/全部|所有|每一?句|整体|全片|统一|整段/u.test(clause)) return 'all';
  if (/这一?句|当前句|本句|选中/u.test(clause)) {
    const index = context.lines.findIndex(line => line.id === context.selectedId);
    return index < 0 ? [] : [index];
  }
  return null;
}

/** 时长：500ms、0.5秒、半秒、一秒半。 */
function durationIn(clause: string): number | null {
  if (/半秒/u.test(clause) && !new RegExp(`${NUM}\\s*秒半`, 'u').test(clause)) return 500;
  const match = new RegExp(`(${NUM}(?:\\.\\d+)?)\\s*(毫秒|ms|秒半|秒|s)`, 'iu').exec(clause);
  if (!match) return null;
  const value = parseNumber(match[1]!);
  if (value === null) return null;
  const unit = match[2]!.toLowerCase();
  return Math.round(unit === '毫秒' || unit === 'ms' ? value : unit === '秒半' ? (value + 0.5) * 1000 : value * 1000);
}

function percentIn(clause: string): number | null {
  const percent = new RegExp(`(${NUM})\\s*(?:%|％)|百分之\\s*(${NUM})`, 'u').exec(clause);
  if (percent) { const value = parseNumber(percent[1] ?? percent[2]!); return value === null ? null : value / 100; }
  const times = /(\d(?:\.\d+)?)\s*倍/u.exec(clause);
  return times ? Number(times[1]) : null;
}

const VOICE_WORDS = /女声|男声|童声|嗓音|声线|旁白|播音|大叔|少女|御姐|萝莉|老人|青年/u;

/** 解析一条指令；可以用逗号、句号或「然后」连接多个要求，没写句子的分句沿用前一个句子。 */
export function parseCommand(input: string, context: AssistantContext): ParseResult {
  const text = input.trim().replace(/\s+/gu, ' ');
  if (!text) return { error: '请输入想做的修改。' };
  const intents: AssistantIntent[] = [];

  // 改台词：引号或「改成」之后的内容原样保留，不再按逗号拆分。
  const rewrite = new RegExp(`^(?:请?把|将)?\\s*(第\\s*${NUM}\\s*[句行]|这一?句|当前句|本句|最后一句)\\s*(?:的)?(?:台词|文字|内容)?\\s*(?:改成|改为|换成|替换成|修改为)\\s*[:：]?\\s*(.+)$`, 'u').exec(text);
  if (rewrite && !/^(?:音色|声音|语气)/u.test(rewrite[2]!)) {
    const refs = lineRefs(rewrite[1]!, context);
    const line = Array.isArray(refs) && refs.length === 1 ? refs[0]! : null;
    const content = rewrite[2]!.replace(/^[「“"'『]|[」”"'』]$/gu, '').trim();
    if (line === null) return { error: invalidLineMessage(context) };
    if (!content) return { error: '新台词不能为空。' };
    return { intents: [{ op: 'text', line, text: content }] };
  }

  let carried: number[] | null = null;
  for (const clause of text.split(/[，,。；;！!？?\n]|然后|并且|再把|同时/u).map(part => part.trim()).filter(Boolean)) {
    const refs = lineRefs(clause, context);
    if (Array.isArray(refs) && !refs.length) return { error: invalidLineMessage(context) };
    const all = context.lines.map((_, index) => index);
    const explicit = refs === 'all' ? all : refs ?? carried;
    const selected = context.lines.findIndex(line => line.id === context.selectedId);
    if (Array.isArray(refs)) carried = refs;
    else if (refs === 'all') carried = all;
    const parsed = parseClause(clause, refs, explicit ?? (selected < 0 ? null : [selected]), explicit === null, context);
    if ('error' in parsed) return parsed;
    // 「太赶了，慢一点」这类重复表达只算一次。
    for (const intent of parsed.intents) if (!intents.some(item => JSON.stringify(item) === JSON.stringify(intent))) intents.push(intent);
  }
  if (!intents.length) return { error: `没听懂这句。可以试试：${ASSISTANT_EXAMPLES.slice(0, 4).join('、')}。` };
  return { intents };
}

function invalidLineMessage(context: AssistantContext) {
  return context.lines.length ? `找不到这句，当前共有 ${context.lines.length} 句台词。` : '还没有台词，请先导入台词。';
}

function parseClause(clause: string, refs: number[] | 'all' | null, lines: number[] | null, implicit: boolean, context: AssistantContext): ParseResult {
  const need = (intent: (lines: number[]) => AssistantIntent): ParseResult => {
    if (lines?.length) return { intents: [intent(lines)] };
    return { error: context.selectedId ? invalidLineMessage(context) : '请说明是第几句，或先在台词表里选中一句。' };
  };
  // 撤销与导出
  if (/^(?:撤销|撤回|还原)(?:刚才|上一步|修改)?/u.test(clause)) return { intents: [{ op: 'undo' }] };
  if (/导出|下载|输出/u.test(clause)) {
    const kind: ExportKind = /字幕|srt/iu.test(clause) ? 'srt' : /交接|工程包|zip/iu.test(clause) ? 'zip' : /mp4|视频|成片/iu.test(clause) ? 'mp4' : 'wav';
    return { intents: [{ op: 'export', kind }] };
  }
  // 音色基准
  const referenceMatch = new RegExp(`(?:用|以|按|拿)\\s*(第\\s*${NUM}\\s*[句行]|这一?句|当前句|本句|最后一句)\\s*(?:的)?\\s*(?:音色|声音|嗓音)|(?:设为|作为|当作?)\\s*(?:音色)?基准`, 'u').exec(clause);
  if (/取消(?:音色)?基准/u.test(clause)) return { intents: [{ op: 'reference', line: null }] };
  if (referenceMatch) {
    const target = referenceMatch[1] ? lineRefs(referenceMatch[1], context) : refs;
    const line = Array.isArray(target) && target.length === 1 ? target[0]! : lines?.length === 1 ? lines[0]! : null;
    if (line === null) return { error: '请指定一句作为音色基准，例如「用第 1 句的音色统一全部」。' };
    return { intents: [{ op: 'reference', line }] };
  }
  // 音色描述
  const voice = /(?:音色|声音|嗓音|语气)\s*(?:换成|改成|改为|用|设为|变成)\s*(.+)$|(?:音色|嗓音)\s*(恢复默认|恢复|还原)/u.exec(clause)
    ?? (VOICE_WORDS.test(clause) ? /(?:换成|改成|改为|用|变成)\s*(.+)$/u.exec(clause) : null);
  if (voice) {
    const instruction = (voice[1] ?? voice[2]!).replace(/[的了吧]+$/u, '').trim();
    const value = /默认|恢复|跟随|继承/u.test(instruction) ? null : instruction;
    if (value !== null && (!value || value.length > 200)) return { error: '音色描述需要 1–200 个字。' };
    // 没指明句子时改整体音色。
    return refs === 'all' || implicit ? { intents: [{ op: 'voice', lines: 'all', instruction: value }] } : need(ids => ({ op: 'voice', lines: ids, instruction: value }));
  }
  // 跳转与试听
  if (/^(?:跳到|定位到|转到|看看|选中|打开|去)/u.test(clause) && lines?.length) return { intents: [{ op: 'select', line: lines[0]! }] };
  if (/播放|试听|听一下|听听/u.test(clause)) return { intents: [...(refs && lines?.length ? [{ op: 'select' as const, line: lines[0]! }] : []), { op: 'play' }] };
  // 全局命令
  if (/贴合|对齐视频|对齐画面|自动排布|重新排布/u.test(clause)) return { intents: [{ op: 'fit' }] };
  if (/(?:补齐|生成|更新|重新生成|重配).*配音|配音.*(?:补齐|生成|更新)/u.test(clause) && !refs) return { intents: [{ op: 'generate' }] };
  if (/检查|有什么问题|有没有问题|哪里不对/u.test(clause)) return { intents: [{ op: 'check' }] };
  if (/确认/u.test(clause)) return need(ids => ({ op: 'confirm', lines: ids }));
  // 静音
  if (/取消静音|恢复声音|打开声音/u.test(clause)) return need(ids => ({ op: 'mute', lines: ids, muted: false }));
  if (/静音|不要声音|关掉声音/u.test(clause)) return need(ids => ({ op: 'mute', lines: ids, muted: true }));
  // 衔接：重叠、停顿、紧凑
  const ms = durationIn(clause);
  const after = /后面|之后|后边|结尾|句尾|后头/u.test(clause);
  const between = /之间|中间|间隔/u.test(clause);
  const joinTargets = (ids: number[]) => after ? ids.map(index => index + 1).filter(index => index < context.lines.length)
    // 「第 3、4 句间隔」指两句之间，只改后一句的衔接。
    : between && ids.length === 2 && ids[1] === ids[0]! + 1 ? [ids[1]!] : ids;
  if (/恢复自动(?:间隔|停顿)|自动间隔/u.test(clause)) return need(ids => ({ op: 'join', lines: joinTargets(ids), ms: null }));
  if (/重叠|叠上|交叠/u.test(clause)) return need(ids => ({ op: 'join', lines: joinTargets(ids), ms: -Math.abs(ms ?? 200) }));
  if (/紧凑|连上|接上|去掉停顿|不要停顿|无缝/u.test(clause)) return need(ids => ({ op: 'join', lines: joinTargets(ids), ms: 0 }));
  if (/停顿|停|空白|间隔|留白|空一下|歇/u.test(clause) || new RegExp(`空\\s*(?:${NUM}|半)`, 'u').test(clause)) {
    return need(ids => ({ op: 'join', lines: joinTargets(ids), ms: ms ?? DEFAULT_PAUSE_MS }));
  }
  // 语速
  const value = percentIn(clause);
  if (/语速|速度|倍速/u.test(clause) && value !== null) return need(ids => ({ op: 'speed', lines: ids, value }));
  if (/正常语速|恢复语速|原速/u.test(clause)) return need(ids => ({ op: 'speed', lines: ids, value: 1 }));
  if (/太快|太赶|太急|慢一?点|慢些|放慢|慢下来|减速/u.test(clause)) return need(ids => ({ op: 'speed', lines: ids, delta: -STEP_SPEED }));
  if (/太慢|太拖|快一?点|快些|加快|加速|提速/u.test(clause)) return need(ids => ({ op: 'speed', lines: ids, delta: STEP_SPEED }));
  // 音量
  if (/音量|响度/u.test(clause) && value !== null) return need(ids => ({ op: 'gain', lines: ids, value }));
  if (/太小声|听不清|大声|响一?点|音量大|音量调大|声音大一?点/u.test(clause)) return need(ids => ({ op: 'gain', lines: ids, delta: STEP_GAIN }));
  if (/太吵|太响|太大声|小声|轻一?点|音量小|音量调小|声音小一?点/u.test(clause)) return need(ids => ({ op: 'gain', lines: ids, delta: -STEP_GAIN }));
  // 只提到句子：选中它
  if (refs && refs !== 'all' && lines?.length) return { intents: [{ op: 'select', line: lines[0]! }] };
  return { intents: [] };
}

export interface PlanStep { kind: AssistantIntent['op']; label: string }
export interface AssistantPlan {
  /** 一次性提交的数据修改（一步撤销）。 */
  changes: Data;
  steps: PlanStep[];
  /** 改动影响排布，需要重新贴合视频。 */
  retime: boolean;
  /** 跳过的部分及原因。 */
  notes: string[];
  commands: CommandIntent[];
}

const pct = (value: number) => `${Math.round(value * 100)}%`;
const lineName = (indexes: number[]) => indexes.length === 1 ? `第 ${indexes[0]! + 1} 句`
  : indexes.every((value, i) => i === 0 || value === indexes[i - 1]! + 1) ? `第 ${indexes[0]! + 1}–${indexes.at(-1)! + 1} 句` : `第 ${indexes.map(i => i + 1).join('、')} 句`;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** 把意图换算成数据修改；依次在同一份草稿上叠加，保证多个要求一起生效。 */
export function planIntents(data: Data, intents: AssistantIntent[], context: AssistantContext): AssistantPlan {
  let work: Data = { ...data };
  const changes: Data = {};
  const steps: PlanStep[] = [];
  const notes: string[] = [];
  const commands: CommandIntent[] = [];
  let retime = false;
  const apply = (next: Data) => { Object.assign(changes, next); work = { ...work, ...next }; };
  const segmentsOf = () => (Array.isArray(work.segments) ? work.segments : []) as DramaAudioSegment[];
  const idOf = (index: number) => context.lines[index]!.id;
  const withAudio = (indexes: number[], what: string) => {
    const ok = indexes.filter(index => segmentsOf().some(segment => segment.id === idOf(index)));
    const missing = indexes.filter(index => !ok.includes(index));
    if (missing.length) notes.push(`${lineName(missing)}还没有配音，无法调整${what}。`);
    return ok;
  };

  for (const intent of intents) {
    switch (intent.op) {
      case 'speed': {
        const targets = withAudio(intent.lines, '语速');
        if (!targets.length) break;
        const before = segmentsOf();
        const values = new Map(targets.map(index => {
          const old = before.find(segment => segment.id === idOf(index))!.speed ?? 1;
          return [idOf(index), Math.round(clamp(intent.value ?? old + (intent.delta ?? 0), ...SPEED_RANGE) * 100) / 100] as const;
        }));
        const first = before.find(segment => segment.id === idOf(targets[0]!))!;
        apply({ segments: before.map(segment => values.has(segment.id) ? { ...segment, speed: values.get(segment.id)! } : segment) });
        const next = values.get(idOf(targets[0]!))!;
        steps.push({ kind: 'speed', label: targets.length === 1 ? `${lineName(targets)}语速 ${pct(first.speed ?? 1)} → ${pct(next)}` : `${lineName(targets)}语速${intent.value !== undefined ? ` → ${pct(next)}` : (intent.delta ?? 0) < 0 ? '放慢 10%' : '加快 10%'}` });
        if ((intent.value ?? 1) < SPEED_RANGE[0] || (intent.value ?? 1) > SPEED_RANGE[1]) notes.push('语速范围为 80%–130%，已按边界设置。');
        retime = true;
        break;
      }
      case 'gain': {
        const gains = { ...(work.lineGains as Record<string, number> | undefined) };
        const segments = segmentsOf();
        const values = new Map(intent.lines.map(index => {
          const id = idOf(index);
          const old = segments.find(segment => segment.id === id)?.gain ?? gains[id] ?? 1;
          return [id, Math.round(clamp(intent.value ?? old + (intent.delta ?? 0), 0, 2) * 100) / 100] as const;
        }));
        const oldFirst = segments.find(segment => segment.id === idOf(intent.lines[0]!))?.gain ?? gains[idOf(intent.lines[0]!)] ?? 1;
        for (const [id, gain] of values) gains[id] = gain;
        apply({ lineGains: gains, segments: segments.map(segment => values.has(segment.id) ? { ...segment, gain: values.get(segment.id)! } : segment) });
        steps.push({ kind: 'gain', label: intent.lines.length === 1 ? `${lineName(intent.lines)}音量 ${pct(oldFirst)} → ${pct(values.get(idOf(intent.lines[0]!))!)}` : `${lineName(intent.lines)}音量${intent.value !== undefined ? ` → ${pct(intent.value)}` : (intent.delta ?? 0) < 0 ? '调小 20%' : '调大 20%'}` });
        break;
      }
      case 'mute': {
        const targets = withAudio(intent.lines, '静音');
        if (!targets.length) break;
        const ids = new Set(targets.map(idOf));
        apply({ segments: segmentsOf().map(segment => ids.has(segment.id) ? { ...segment, muted: intent.muted } : segment) });
        steps.push({ kind: 'mute', label: `${lineName(targets)}${intent.muted ? '静音' : '取消静音'}` });
        break;
      }
      case 'join': {
        const targets = intent.lines.filter(index => index > 0);
        if (targets.length < intent.lines.length || !intent.lines.length) notes.push('第 1 句前面没有上一句，已跳过。');
        if (!targets.length) break;
        for (const index of targets) apply(setJoin(work, idOf(index), intent.ms));
        const pairs = targets.map(index => `${index}、${index + 1}`).join('；');
        steps.push({ kind: 'join', label: intent.ms === null ? `第 ${pairs} 句间隔恢复自动` : intent.ms < 0 ? `第 ${pairs} 句重叠 ${-intent.ms} ms` : `第 ${pairs} 句间隔 → ${intent.ms} ms` });
        retime = true;
        break;
      }
      case 'text': {
        const id = idOf(intent.line);
        const rewriteLines = (Array.isArray(work.rewriteLines) ? work.rewriteLines as { id: string; text: string }[] : []).map(line => line.id === id ? { ...line, text: intent.text } : line);
        const confirmed = Array.isArray(work.confirmedLineIds) ? (work.confirmedLineIds as string[]).filter(value => value !== id) : [];
        apply({ rewriteLines, script: rewriteLines.map(line => line.text).join('\n'), confirmedLineIds: confirmed,
          segments: segmentsOf().map(segment => segment.id === id ? { ...segment, label: intent.text } : segment) });
        steps.push({ kind: 'text', label: `第 ${intent.line + 1} 句改为「${intent.text.length > 24 ? `${intent.text.slice(0, 24)}…` : intent.text}」` });
        if (segmentsOf().some(segment => segment.id === id)) notes.push('改词后这句配音会显示待更新，可让我「更新配音」。');
        break;
      }
      case 'voice': {
        if (intent.lines === 'all') {
          apply({ voiceInstruction: intent.instruction });
          steps.push({ kind: 'voice', label: intent.instruction ? `整体音色 → ${intent.instruction}` : '整体音色恢复默认' });
        } else {
          const overrides = { ...(work.lineVoiceInstructions as Record<string, string> | undefined) };
          for (const index of intent.lines) {
            if (intent.instruction) overrides[idOf(index)] = intent.instruction;
            else delete overrides[idOf(index)];
          }
          apply({ lineVoiceInstructions: overrides });
          steps.push({ kind: 'voice', label: `${lineName(intent.lines)}音色 → ${intent.instruction ?? (work.voiceReference ? '跟随基准' : '继承整体')}` });
        }
        break;
      }
      case 'reference': {
        if (intent.line === null) {
          apply({ voiceReference: null });
          steps.push({ kind: 'reference', label: '取消音色基准' });
          break;
        }
        const id = idOf(intent.line);
        const segment = segmentsOf().find(item => item.id === id);
        const audioRef = segment ? segment.audioRefOverride ?? (typeof work.audioRef === 'string' ? work.audioRef : null) : null;
        if (!segment || !audioRef) { notes.push(`第 ${intent.line + 1} 句还没有配音，不能作为音色基准。`); break; }
        const text = context.lines[intent.line]!.text;
        apply({ voiceReference: { lineId: id, audioRef, startMs: segment.startMs, endMs: segment.endMs, text,
          voice: (work.generatedLineVoices as Record<string, string> | undefined)?.[id] ?? effectiveLineVoice(work, id) } });
        steps.push({ kind: 'reference', label: `第 ${intent.line + 1} 句设为音色基准，其他句子按它的音色生成` });
        break;
      }
      case 'confirm': {
        const ids = Array.isArray(work.confirmedLineIds) ? work.confirmedLineIds as string[] : [];
        apply({ confirmedLineIds: [...new Set([...ids, ...intent.lines.map(idOf)])] });
        steps.push({ kind: 'confirm', label: `确认${lineName(intent.lines)}` });
        break;
      }
      default:
        commands.push(intent);
    }
  }
  return { changes, steps, retime, notes, commands };
}

/** 命令的简短说明，用于回复。 */
export function describeCommand(command: CommandIntent, context: AssistantContext): string {
  switch (command.op) {
    case 'select': return `跳到第 ${command.line + 1} 句：${context.lines[command.line]?.text ?? ''}`;
    case 'fit': return '贴合视频';
    case 'generate': return '补齐配音';
    case 'check': return '检查问题';
    case 'play': return '同步播放';
    case 'undo': return '撤销上一步';
    case 'export': return { srt: '导出字幕 SRT', wav: '导出 WAV', mp4: '导出 MP4', zip: '下载剪辑交接包' }[command.kind];
  }
}
