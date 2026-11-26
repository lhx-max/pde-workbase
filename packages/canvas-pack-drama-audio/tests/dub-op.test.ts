import { afterEach, describe, expect, it, vi } from 'vitest';
import { dramaAudioOps as ops } from '../src/ops';

/** dub handler 的执行上下文类型（含可选二进制文件口）。 */
type Ctx = Parameters<typeof ops.dub>[2];

const origin = 'http://127.0.0.1:8808';
const completeEvent = 'event: complete\ndata: [{"url":"http://127.0.0.1:8808/gradio_api/file=/tmp/out.wav"}]\n\n';

function makeWav(dataBytes = 8_000, byteRate = 8_000): Uint8Array {
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0);
  view.setUint32(4, 36 + dataBytes, true);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8);
  bytes.set([0x66, 0x6d, 0x74, 0x20], 12);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, byteRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  bytes.set([0x64, 0x61, 0x74, 0x61], 36);
  view.setUint32(40, dataBytes, true);
  return bytes;
}

function stubTts(wav = makeWav()) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = String(input);
    if (url === `${origin}/gradio_api/upload`) return new Response(JSON.stringify(['/tmp/ref.wav']), { status: 200 });
    if (url === `${origin}/gradio_api/call/generate`) return new Response(JSON.stringify({ event_id: 'evt_42' }), { status: 200 });
    if (url.startsWith(`${origin}/gradio_api/call/generate/`)) return new Response(completeEvent);
    return new Response(wav as Uint8Array<ArrayBuffer>);
  }));
}

type ByteFiles = {
  byteFiles: Map<string, Uint8Array>;
  read(projectId: string, relative: string): Promise<string | null>;
  write(projectId: string, relative: string, content: string): Promise<void>;
  readBytes(projectId: string, relative: string): Promise<Uint8Array | null>;
  writeBytes(projectId: string, relative: string, bytes: Uint8Array): Promise<void>;
};

function makeFiles(): ByteFiles {
  const byteFiles = new Map<string, Uint8Array>();
  return {
    byteFiles,
    async read() { return null; },
    async write() {},
    async readBytes(_projectId, relative) { return byteFiles.get(relative) ?? null; },
    async writeBytes(_projectId, relative, bytes) { byteFiles.set(relative, bytes); },
  };
}

const baseData = () => ({
  audioRef: null, durationMs: 0, videoRef: 'inputs/episode.mp4', videoDurationMs: 12_000,
  voiceInstruction: '自然清晰的普通话解说',
  rewriteLines: [
    { id: 'line-a', text: '雨夜里他停下脚步。', videoStartMs: 0, videoEndMs: 6_000 },
    { id: 'line-b', text: '回声渐渐散去。', videoStartMs: 6_000, videoEndMs: 12_000 },
  ],
  segments: [],
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('card.drama.audio.dub', () => {
  it('合成真实配音：先写工程 outputs/voice，再绑定该句并记录配音来源', async () => {
    stubTts();
    const files = makeFiles();
    const ctx: Ctx = { projectId: 'p1', files };
    const patch = await ops.dub({ id: 'c1', kind: 'card.drama.audio', data: baseData() }, { lineId: 'line-a' }, ctx);
    const data = patch?.data as Record<string, unknown>;
    expect([...files.byteFiles.keys()]).toEqual(['outputs/voice/voxcpm-evt_42.wav']);
    expect(data.audioRef).toBe('outputs/voice/voxcpm-evt_42.wav');
    expect(data.durationMs).toBe(1_000);
    const segment = (data.segments as { id: string; audioRefOverride: string | null; endMs: number }[]).find(item => item.id === 'line-a');
    expect(segment?.audioRefOverride).toBe('outputs/voice/voxcpm-evt_42.wav');
    expect(segment?.endMs).toBe(1_000);
    expect((data.generatedLineTexts as Record<string, string>)['line-a']).toBe('雨夜里他停下脚步。');
    expect((data.generatedLineVoices as Record<string, string>)['line-a']).toBe('自然清晰的普通话解说');
  });

  it('同输入重放产生相同的 data 补丁（确定性）', async () => {
    stubTts();
    const ctx: Ctx = { projectId: 'p1', files: makeFiles() };
    const node = { id: 'c1', kind: 'card.drama.audio', data: baseData() };
    const first = await ops.dub(node, { lineId: 'line-a' }, ctx);
    const second = await ops.dub(node, { lineId: 'line-a' }, ctx);
    expect(second).toEqual(first);
  });

  it('音色基准克隆：读取工程 WAV、截取参考并按克隆语义提交', async () => {
    const calls: { url: string; body?: string | undefined }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
      if (url === `${origin}/gradio_api/upload`) return new Response(JSON.stringify(['/tmp/ref.wav']), { status: 200 });
      if (url === `${origin}/gradio_api/call/generate`) return new Response(JSON.stringify({ event_id: 'evt_42' }), { status: 200 });
      if (url.startsWith(`${origin}/gradio_api/call/generate/`)) return new Response(completeEvent);
      return new Response(makeWav() as Uint8Array<ArrayBuffer>);
    }));
    const files = makeFiles();
    files.byteFiles.set('outputs/voice/base.wav', makeWav(16_000, 8_000));
    const data = {
      ...baseData(), voiceReference: {
        lineId: 'line-b', audioRef: 'outputs/voice/base.wav', startMs: 1_000, endMs: 2_500, text: '回声渐渐散去。',
        voice: '基准音色',
      },
    };
    const patch = await ops.dub({ id: 'c1', kind: 'card.drama.audio', data }, { lineId: 'line-a' }, { projectId: 'p1', files });
    const body = JSON.parse(calls.find(call => call.url.endsWith('/gradio_api/call/generate'))!.body!);
    expect(body.data[0]).toBe('雨夜里他停下脚步。');
    expect(body.data[1]).toBe('');
    expect(body.data[3]).toBe(true);
    expect(body.data[4]).toBe('回声渐渐散去。');
    expect((patch?.data as Record<string, unknown>).segments).toHaveLength(1);
    expect(((patch?.data as Record<string, unknown>).segments as { id: string }[])[0].id).toBe('line-a');
  });

  it('逐句音色覆盖时以基准为参考按描述调整', async () => {
    const calls: { url: string; body?: string | undefined }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
      if (url === `${origin}/gradio_api/upload`) return new Response(JSON.stringify(['/tmp/ref.wav']), { status: 200 });
      if (url === `${origin}/gradio_api/call/generate`) return new Response(JSON.stringify({ event_id: 'evt_42' }), { status: 200 });
      if (url.startsWith(`${origin}/gradio_api/call/generate/`)) return new Response(completeEvent);
      return new Response(makeWav() as Uint8Array<ArrayBuffer>);
    }));
    const files = makeFiles();
    files.byteFiles.set('outputs/voice/base.wav', makeWav());
    const data = {
      ...baseData(),
      lineVoiceInstructions: { 'line-a': '低沉磁性男声' },
      voiceReference: { lineId: 'line-b', audioRef: 'outputs/voice/base.wav', startMs: 0, endMs: 1_500, text: '回声渐渐散去。' },
    };
    await ops.dub({ id: 'c1', kind: 'card.drama.audio', data }, { lineId: 'line-a' }, { projectId: 'p1', files });
    const body = JSON.parse(calls.find(call => call.url.endsWith('/gradio_api/call/generate'))!.body!);
    expect(body.data[1]).toBe('低沉磁性男声');
    expect(body.data[3]).toBe(false);
  });

  it('台词不存在 / 区间锁定显式拒绝', async () => {
    stubTts();
    const ctx: Ctx = { projectId: 'p1', files: makeFiles() };
    await expect(ops.dub({ id: 'c1', kind: 'card.drama.audio', data: baseData() }, { lineId: 'line-x' }, ctx)).rejects.toThrow(/不存在/);
    const locked = { ...baseData(), directorEdit: { locks: [{ startMs: 0, endMs: 3_000 }] } };
    await expect(ops.dub({ id: 'c1', kind: 'card.drama.audio', data: locked }, { lineId: 'line-a' }, ctx)).rejects.toThrow(/锁定/);
    expect(ops.dub({ id: 'c1', kind: 'card.drama.audio', data: locked }, { lineId: 'line-b' }, ctx)).resolves.toBeTruthy();
  });

  it('缺少二进制文件口 / 多余参数 / VoxCPM 不可达显式报错', async () => {
    const textOnly = { projectId: 'p1', files: { async read() { return null; }, async write() {} } } as unknown as Ctx;
    await expect(ops.dub({ id: 'c1', kind: 'card.drama.audio', data: baseData() }, { lineId: 'line-a' }, textOnly)).rejects.toThrow(/二进制文件口/);
    const ctx: Ctx = { projectId: 'p1', files: makeFiles() };
    await expect(ops.dub({ id: 'c1', kind: 'card.drama.audio', data: baseData() }, { lineId: 'line-a', speed: 1 }, ctx)).rejects.toThrow(/不支持参数 speed/);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    await expect(ops.dub({ id: 'c1', kind: 'card.drama.audio', data: baseData() }, { lineId: 'line-a' }, ctx)).rejects.toThrow(/不可达，dub 不可用/);
  });
});
