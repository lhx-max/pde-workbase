import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCanvasActions, parseCanvasActions, probeMediaDurationMs, renderReceiptLines } from '../src/server/canvas-actions';

const ORIGIN = process.env.CANVAS_SERVER_ORIGIN;
const STATE = {
  ok: true,
  revision: 7,
  state: {
    workbenchBasicNodes: [
      { id: 'card-a', kind: 'card.drama.audio', title: '第一幕', x: 10, y: 20 },
    ],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGIN === undefined) delete process.env.CANVAS_SERVER_ORIGIN;
  else process.env.CANVAS_SERVER_ORIGIN = ORIGIN;
});

it('parseCanvasActions：提取最后一个动作块；坏 JSON 视为空动作；无块返回 null', () => {
  const text = '建议如下\n```canvas-actions\n{"actions":[{"type":"update_card","cardId":"card-a","title":"改名"}]}\n```';
  expect(parseCanvasActions(text)).toEqual([{ type: 'update_card', cardId: 'card-a', title: '改名' }]);
  expect(parseCanvasActions('```canvas-actions\nnot json\n```')).toEqual([]);
  expect(parseCanvasActions('只是普通建议')).toBeNull();
});

it('动作映射为平台 operations 并提交（含 card_op 与 import_media 双轨导入）', async () => {
  process.env.CANVAS_SERVER_ORIGIN = 'http://127.0.0.1:18899';
  const bodies: unknown[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/operations')) {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ data: { receipt: { status: 'applied' }, revision: 8 } }), { status: 200 });
    }
    if (init?.method === 'HEAD') return new Response(null, { status: 200 });
    return new Response(JSON.stringify(STATE), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const actions = [
    { type: 'update_card' as const, cardId: 'card-a', title: '改名', x: 33 },
    { type: 'card_op' as const, cardId: 'card-a', op: 'voice', params: { voiceInstruction: '低沉男声' } },
    { type: 'card_op' as const, cardId: 'card-a', op: 'speed', params: { segmentId: 'seg-0', speed: 0.75 } },
    { type: 'import_media' as const, cardId: 'card-a', title: '新片段', audioRef: 'outputs/voice/a.mp3', durationMs: 60_000, videoRef: 'inputs/v.mp4', videoDurationMs: 60_000 },
  ];
  const { receipts, invalid, conflict } = await applyCanvasActions('p1', actions);
  expect(conflict).toBeUndefined();
  expect(invalid).toEqual([]);
  expect(receipts.map(receipt => receipt.status)).toEqual(['applied', 'applied', 'applied', 'applied', 'applied']);
  const request = bodies[0] as { baseRevision: number; operations: { type: string; nodeId?: string; node?: { kind?: string }; params?: Record<string, unknown> }[] };
  expect(request.baseRevision).toBe(7);
  expect(request.operations.map(op => op.type)).toEqual([
    'node.move', 'node.rename', 'card.drama.audio.voice', 'card.drama.audio.speed', 'card.drama.audio.attach',
  ]);
  expect(request.operations[4].params).toMatchObject({ audioRef: 'outputs/voice/a.mp3', durationMs: 60_000, videoRef: 'inputs/v.mp4' });
  expect(renderReceiptLines(receipts, invalid)).toContain('已执行');
});

it('dub 动作映射为 card.drama.audio.dub 并进入提交（慢动作通道）', async () => {
  process.env.CANVAS_SERVER_ORIGIN = 'http://127.0.0.1:18899';
  const bodies: unknown[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/operations')) {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ data: { receipt: { status: 'applied' }, revision: 8 } }), { status: 200 });
    }
    return new Response(JSON.stringify(STATE), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const { receipts, invalid } = await applyCanvasActions('p1', [
    { type: 'card_op', cardId: 'card-a', op: 'dub', params: { lineId: 'seg-0' } },
  ]);
  expect(invalid).toEqual([]);
  expect(receipts[0]).toMatchObject({ status: 'applied', label: '卡片 card-a 生成配音' });
  const request = bodies[0] as { operations: { type: string; nodeId?: string; params?: Record<string, unknown> }[] };
  expect(request.operations).toEqual([{ type: 'card.drama.audio.dub', nodeId: 'card-a', params: { lineId: 'seg-0' } }]);
});

it('import_media 缺少 cardId 时拒绝，不再隐式新建卡', async () => {
  process.env.CANVAS_SERVER_ORIGIN = 'http://127.0.0.1:18899';
  const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
    String(input).endsWith('/operations') ? Promise.reject(new Error('should not post')) : new Response(JSON.stringify(STATE), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const { receipts, invalid } = await applyCanvasActions('p1', [
    { type: 'import_media', x: 0, y: 0, audioRef: 'outputs/voice/a.mp3', durationMs: 1000 },
  ]);
  expect(receipts).toEqual([]);
  expect(invalid.join('\n')).toContain('cardId');
});

it('白名单外 op、未知卡片与非开放卡种校验拒绝且不发起 operations 请求', async () => {
  process.env.CANVAS_SERVER_ORIGIN = 'http://127.0.0.1:18899';
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/operations')) throw new Error('should not post');
    return new Response(JSON.stringify(STATE), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const { receipts, invalid } = await applyCanvasActions('p1', [
    { type: 'card_op', cardId: 'card-a', op: 'deleteProject' },
    { type: 'card_op', cardId: 'ghost', op: 'gain', params: { gain: 1 } },
    { type: 'create_card', kind: 'card.video', x: 0, y: 0 },
  ]);
  expect(receipts).toEqual([]);
  expect(invalid).toHaveLength(3);
  const joined = invalid.join('\n');
  expect(joined).toContain('白名单');
  expect(joined).toContain('不存在');
  expect(joined).toContain('白名单');
});

it('operations 409 冲突整批失败并标记 conflict', async () => {
  process.env.CANVAS_SERVER_ORIGIN = 'http://127.0.0.1:18899';
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).endsWith('/operations')
      ? new Response(JSON.stringify({ error: { code: 'CANVAS_REVISION_CONFLICT' } }), { status: 409 })
      : new Response(JSON.stringify(STATE), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const { receipts, conflict } = await applyCanvasActions('p1', [{ type: 'update_card', cardId: 'card-a', title: 'x' }]);
  expect(conflict).toBe(true);
  expect(receipts.every(receipt => receipt.status === 'failed')).toBe(true);
});

it('import_media 引用不存在的工程文件被拒绝', async () => {
  process.env.CANVAS_SERVER_ORIGIN = 'http://127.0.0.1:18899';
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
    init?.method === 'HEAD' ? new Response(null, { status: 404 }) : new Response(JSON.stringify(STATE), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const { receipts, invalid } = await applyCanvasActions('p1', [
    { type: 'import_media', cardId: 'card-a', audioRef: 'missing/a.mp3', durationMs: 1000 },
  ]);
  expect(receipts).toEqual([]);
  expect(invalid.join('\n')).toContain('文件不存在');
});

it('renderReceiptLines：无回执且无拒绝时返回空串', () => {
  expect(renderReceiptLines([], [])).toBe('');
});

afterEach(() => {
  try { rmSync(join(tmpdir(), 'canvas-actions-test-files'), { recursive: true, force: true }); } catch { /* tmp cleanup */ }
});

function buildIsoBmff(timescale: number, duration: number): Buffer {
  const mvhd = Buffer.alloc(108);
  mvhd.writeUInt32BE(100, 0);
  mvhd.write('mvhd', 4, 'ascii');
  mvhd.writeUInt32BE(0, 8); // version 0
  mvhd.writeUInt32BE(timescale, 20);
  mvhd.writeUInt32BE(duration, 24);
  const moov = Buffer.alloc(8 + mvhd.length);
  moov.writeUInt32BE(moov.length, 0);
  moov.write('moov', 4, 'ascii');
  mvhd.copy(moov, 8);
  const ftyp = Buffer.alloc(16);
  ftyp.writeUInt32BE(16, 0); ftyp.write('ftyp', 4, 'ascii'); ftyp.write('isom', 8, 'ascii');
  return Buffer.concat([ftyp, moov]);
}

function buildWav(sampleRate: number, seconds: number): Buffer {
  const n = sampleRate * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii'); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii'); buf.writeUInt32LE(n * 2, 40);
  return buf;
}

it('probeMediaDurationMs：mp4 mvhd 与 wav data 块可解析，未知容器返回 null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'canvas-actions-test-files'));
  const mp4 = join(dir, 'a.mp4');
  writeFileSync(mp4, buildIsoBmff(1000, 4200));
  expect(probeMediaDurationMs(mp4, '.mp4')).toBe(4200);
  const wav = join(dir, 'a.wav');
  writeFileSync(wav, buildWav(8000, 2));
  expect(probeMediaDurationMs(wav, '.wav')).toBe(2000);
  const txt = join(dir, 'a.txt');
  writeFileSync(txt, 'x');
  expect(probeMediaDurationMs(txt, '.txt')).toBeNull();
});

it('import_media src（本机视频）自动复制进工程并绑定到已有卡片（不新建卡）', async () => {
  process.env.CANVAS_SERVER_ORIGIN = 'http://127.0.0.1:18899';
  const dir = mkdtempSync(join(tmpdir(), 'canvas-actions-test-files'));
  const mp4 = join(dir, '念念有回响.mp4');
  writeFileSync(mp4, buildIsoBmff(1000, 30000));
  const uploads: Record<string, unknown>[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/upload')) {
      const form = init?.body as FormData;
      uploads.push({ dir: form.get('dir'), name: (form.get('files') as File).name });
      return new Response(JSON.stringify({ files: [{ name: 'inputs/念念有回响.mp4', originalName: '念念有回响.mp4' }] }), { status: 200 });
    }
    if (url.endsWith('/operations')) return new Response(JSON.stringify({ data: { receipt: { status: 'applied' } } }), { status: 200 });
    return new Response(JSON.stringify(STATE), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const { receipts, invalid } = await applyCanvasActions('p1', [
    { type: 'import_media', cardId: 'card-a', title: '念念有回响', src: mp4 },
  ]);
  expect(invalid).toEqual([]);
  expect(uploads[0]).toMatchObject({ dir: 'inputs', name: '念念有回响.mp4' });
  const request = JSON.parse(String((fetchMock.mock.calls.find(call => String(call[0]).endsWith('/operations'))?.[1] as RequestInit | undefined)?.body)) as
    { operations: { type: string; params?: Record<string, unknown> }[] };
  expect(request.operations.map(op => op.type)).toEqual(['card.drama.audio.video']);
  expect(request.operations[0].params).toEqual({ videoRef: 'inputs/念念有回响.mp4', videoDurationMs: 30000 });
  expect(receipts.every(receipt => receipt.status === 'applied')).toBe(true);
});

it('import_media src（本机 wav）探测时长并走 attach；src 缺失或扩展名越界显式拒绝', async () => {
  process.env.CANVAS_SERVER_ORIGIN = 'http://127.0.0.1:18899';
  const dir = mkdtempSync(join(tmpdir(), 'canvas-actions-test-files'));
  const wav = join(dir, 'a.wav');
  writeFileSync(wav, buildWav(8000, 3));
  const txt = join(dir, 'note.txt');
  writeFileSync(txt, 'x');
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/upload')) return new Response(JSON.stringify({ files: [{ name: 'outputs/voice/a-1.wav' }] }), { status: 200 });
    if (url.endsWith('/operations')) return new Response(JSON.stringify({ data: { receipt: { status: 'applied' } } }), { status: 200 });
    return new Response(JSON.stringify(STATE), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const ok = await applyCanvasActions('p1', [{ type: 'import_media', cardId: 'card-a', src: wav }]);
  expect(ok.invalid).toEqual([]);
  const request = JSON.parse(String((fetchMock.mock.calls.find(call => String(call[0]).endsWith('/operations'))?.[1] as RequestInit | undefined)?.body)) as
    { operations: { type: string; params?: Record<string, unknown> }[] };
  expect(request.operations[0].type).toBe('card.drama.audio.attach');
  expect(request.operations[0].params).toEqual({ audioRef: 'outputs/voice/a-1.wav', durationMs: 3000 });

  const missing = await applyCanvasActions('p1', [{ type: 'import_media', cardId: 'card-a', src: '/nonexistent/a.mp4' }]);
  expect(missing.receipts).toEqual([]);
  expect(missing.invalid.join('\n')).toContain('src');

  const badExt = await applyCanvasActions('p1', [{ type: 'import_media', cardId: 'card-a', src: txt }]);
  expect(badExt.invalid.join('\n')).toContain('白名单');
});
