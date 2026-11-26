import { afterEach, describe, expect, it, vi } from 'vitest';
import { clipWavBytes, synthesizeServerTts, wavDurationMs } from '../src/local-tts';

const origin = 'http://127.0.0.1:8808';
const completeEvent = 'event: generating\ndata: null\n\nevent: complete\ndata: [{"url":"http://127.0.0.1:8808/gradio_api/file=/tmp/out.wav"}]\n\n';

/** 构造最小合法 PCM WAV：44 字节头 + dataBytes 字节数据，byteRate 字节/秒。 */
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

type Route = 'upload' | 'call' | 'result' | 'audio';
type Calls = { url: string; init: RequestInit | undefined }[];

function stubTts(overrides: Partial<Record<Route, () => Response | Promise<Response>>> = {}, wav = makeWav()) {
  const calls: Calls = [];
  const routes: Record<Route, () => Response | Promise<Response>> = {
    upload: () => new Response(JSON.stringify(['/tmp/ref.wav']), { status: 200 }),
    call: () => new Response(JSON.stringify({ event_id: 'evt_42' }), { status: 200 }),
    result: () => new Response(completeEvent),
    audio: () => new Response(wav as Uint8Array<ArrayBuffer>),
    ...overrides,
  };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === `${origin}/gradio_api/upload`) return routes.upload();
    if (url === `${origin}/gradio_api/call/generate`) return routes.call();
    if (url.startsWith(`${origin}/gradio_api/call/generate/`)) return routes.result();
    return routes.audio();
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WAV 字节工具', () => {
  it('解析 PCM WAV 时长', () => {
    expect(wavDurationMs(makeWav(8_000, 8_000))).toBe(1_000);
    expect(wavDurationMs(makeWav(16_000, 8_000))).toBe(2_000);
  });

  it('非 WAV / 缺块字节显式报错', () => {
    expect(() => wavDurationMs(new Uint8Array(100))).toThrow(/不是可解析的 WAV/);
    expect(() => wavDurationMs(new Uint8Array(20))).toThrow(/不是可解析的 WAV/);
  });

  it('按毫秒截取参考片段并重写块大小', () => {
    const clipped = clipWavBytes(makeWav(8_000, 8_000), 250, 750);
    expect(wavDurationMs(clipped)).toBe(500);
    expect(clipped.byteLength).toBe(44 + 4_000);
  });

  it('截取不足 0.5 秒或非 WAV 源显式报错', () => {
    expect(() => clipWavBytes(makeWav(8_000, 8_000), 0, 100)).toThrow(/至少需要 0.5 秒/);
    expect(() => clipWavBytes(new Uint8Array(200), 0, 1_000)).toThrow(/需要 WAV 源/);
  });
});

describe('synthesizeServerTts：本机 VoxCPM 客户端', () => {
  it('纯描述生成：参数与浏览器端一致（cfg=2、steps=10、seed=42）', async () => {
    const calls = stubTts();
    const result = await synthesizeServerTts({ text: '第一句台词', control: '自然清晰的普通话解说' });
    expect(result).toMatchObject({ eventId: 'evt_42', durationMs: 1_000 });
    expect(result.bytes.byteLength).toBe(44 + 8_000);
    const body = JSON.parse(String(calls.find(call => call.url.endsWith('/gradio_api/call/generate'))?.init?.body));
    expect(body.data).toEqual(['第一句台词', '自然清晰的普通话解说', null, false, '', 2, false, false, 10, 42]);
  });

  it('克隆模式：上传参考并传 refFile + 参考文字', async () => {
    const calls = stubTts();
    await synthesizeServerTts({ text: '台词', control: '', referenceWav: makeWav(), referenceText: '参考文字' });
    expect(calls.some(call => call.url === `${origin}/gradio_api/upload`)).toBe(true);
    const body = JSON.parse(String(calls.find(call => call.url.endsWith('/gradio_api/call/generate'))?.init?.body));
    expect(body.data[2]).toMatchObject({ path: '/tmp/ref.wav', meta: { _type: 'gradio.FileData' } });
    expect(body.data[3]).toBe(true);
    expect(body.data[4]).toBe('参考文字');
  });

  it('以基准为参考按描述调整：clone=false、control=描述', async () => {
    const calls = stubTts();
    await synthesizeServerTts({ text: '台词', control: '活泼明快的年轻女声', referenceWav: makeWav(), referenceText: '参考文字' });
    const body = JSON.parse(String(calls.find(call => call.url.endsWith('/gradio_api/call/generate'))?.init?.body));
    expect(body.data[1]).toBe('活泼明快的年轻女声');
    expect(body.data[3]).toBe(false);
  });

  it('克隆缺参考文字显式报错', async () => {
    stubTts();
    await expect(synthesizeServerTts({ text: '台词', control: '', referenceWav: makeWav() })).rejects.toThrow(/克隆音色需要参考音频对应的文字/);
  });

  it('VoxCPM 不可达时显式报错不假成功', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    await expect(synthesizeServerTts({ text: '台词', control: '音色' })).rejects.toThrow(/不可达，dub 不可用/);
  });

  it('无 complete 事件或返回非本机文件时拒绝', async () => {
    stubTts({ result: () => new Response('event: error\ndata: null\n\n') });
    await expect(synthesizeServerTts({ text: '台词', control: '音色' })).rejects.toThrow(/未返回可用的配音结果/);
    const away = 'event: complete\ndata: [{"url":"http://evil.example.com/gradio_api/file=/x.wav"}]\n\n';
    stubTts({ result: () => new Response(away) });
    await expect(synthesizeServerTts({ text: '台词', control: '音色' })).rejects.toThrow(/非本机音频/);
  });
});
