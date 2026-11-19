import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkLocalVoice, fillMissing, generateCandidate, localVoiceAvailable } from '../src/director/local-voice';

const origin = 'http://127.0.0.1:8808';
const completeEvent = 'event: generating\r\ndata: null\r\n\r\nevent: complete\r\ndata: [{"url":"http://127.0.0.1:8808/gradio_api/file=/tmp/out.wav"}]\r\n\r\n';

type Route = 'info' | 'call' | 'result' | 'audio';
type Calls = { url: string; init: RequestInit | undefined }[];

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}

function stubVox(overrides: Partial<Record<Route, () => Response | Promise<Response>>> = {}) {
  const calls: Calls = [];
  const routes: Record<Route, () => Response | Promise<Response>> = {
    info: () => json({ named_endpoints: { '/generate': {} } }),
    call: () => json({ event_id: 'evt_1' }),
    result: () => new Response(completeEvent),
    audio: () => new Response(new Uint8Array(100)),
    ...overrides,
  };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === `${origin}/gradio_api/info`) return routes.info();
    if (url === `${origin}/gradio_api/call/generate`) return routes.call();
    if (url.startsWith(`${origin}/gradio_api/call/generate/`)) return routes.result();
    return routes.audio();
  }));
  return calls;
}

const baseData = {
  videoDurationMs: 6000, videoRef: 'video/main.mp4', voiceInstruction: '温柔女声',
  rewriteLines: [
    { id: 'a', text: '第一句', videoStartMs: 0, videoEndMs: 3000 },
    { id: 'b', text: '第二句', videoStartMs: 3000, videoEndMs: 6000 },
  ],
};

const live = () => new AbortController().signal;

beforeEach(() => {
  vi.stubGlobal('location', { hostname: '127.0.0.1' });
  vi.stubGlobal('AudioContext', class {
    async decodeAudioData() { return { duration: 1.5 }; }
    async close() {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('本机 VoxCPM 可用性', () => {
  it('只在 127.0.0.1 工作区启用', () => {
    expect(localVoiceAvailable()).toBe(true);
    vi.stubGlobal('location', { hostname: 'localhost' });
    expect(localVoiceAvailable()).toBe(false);
    vi.stubGlobal('location', undefined);
    expect(localVoiceAvailable()).toBe(false);
  });

  it('非本机工作区不发请求直接拒绝', async () => {
    vi.stubGlobal('location', { hostname: 'canvas.example.com' });
    const calls = stubVox();
    await expect(checkLocalVoice(live())).rejects.toThrow(/仅在本机工作区可用/);
    expect(calls).toEqual([]);
  });

  it('检查 Gradio 接口描述，不带凭据且禁止重定向', async () => {
    const calls = stubVox();
    await expect(checkLocalVoice(live())).resolves.toBeUndefined();
    expect(calls[0]).toMatchObject({ url: `${origin}/gradio_api/info`, init: { redirect: 'error', credentials: 'omit' } });
  });

  it.each([
    ['缺少 /generate', () => json({ named_endpoints: {} })],
    ['HTTP 错误', () => json({ named_endpoints: { '/generate': {} } }, 500)],
    ['非 JSON', () => new Response('not json')],
    ['网络失败', () => { throw new TypeError('fetch failed'); }],
  ])('%s 时报告服务不可用', async (_, info) => {
    stubVox({ info });
    await expect(checkLocalVoice(live())).rejects.toThrow(/8808 端口不可用/);
  });

  it('调用方取消时抛出取消原因而不是不可用提示', async () => {
    const controller = new AbortController();
    const reason = new Error('取消');
    stubVox({ info: () => { controller.abort(reason); throw new Error('aborted'); } });
    await expect(checkLocalVoice(controller.signal)).rejects.toBe(reason);
  });
});

describe('生成配音候选', () => {
  it('提交台词与音色，读取 complete 事件中的本机 WAV 并存为会话素材', async () => {
    const calls = stubVox();
    const addMedia = vi.fn(async (file: File) => `session/${file.name}`);
    const candidate = await generateCandidate(() => baseData, addMedia, 'b', live());
    expect(candidate).toEqual({
      lineId: 'b', text: '第二句', voice: '温柔女声', videoRef: 'video/main.mp4', previousSource: null,
      audioRef: 'session/voxcpm-evt_1.wav', durationMs: 1500,
    });
    const file = addMedia.mock.calls[0]![0];
    expect([file.name, file.type, file.size]).toEqual(['voxcpm-evt_1.wav', 'audio/wav', 100]);
    expect(calls.map(call => call.url)).toEqual([
      `${origin}/gradio_api/info`, `${origin}/gradio_api/call/generate`,
      `${origin}/gradio_api/call/generate/evt_1`, `${origin}/gradio_api/file=/tmp/out.wav`,
    ]);
    const post = calls[1]!.init!;
    expect(post).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit' });
    expect(JSON.parse(String(post.body)).data.slice(0, 2)).toEqual(['第二句', '温柔女声']);
  });

  it('台词无效时不访问服务', async () => {
    const calls = stubVox();
    await expect(generateCandidate(() => baseData, vi.fn(), 'missing', live())).rejects.toThrow(/有效台词/);
    await expect(generateCandidate(() => ({ ...baseData, rewriteLines: [] }), vi.fn(), 'a', live())).rejects.toThrow(/1–80 段/);
    expect(calls).toEqual([]);
  });

  it.each<[string, Partial<Record<Route, () => Response>>, RegExp]>([
    ['请求被拒绝', { call: () => json({}, 503) }, /HTTP 503/],
    ['没有任务标识', { call: () => json({}) }, /任务标识/],
    ['任务标识含非法字符', { call: () => json({ event_id: '../x' }) }, /任务标识/],
    ['结果读取失败', { result: () => new Response('', { status: 500 }) }, /结果读取失败/],
    ['没有 complete 事件', { result: () => new Response('event: error\ndata: "boom"\n\n') }, /可用的配音结果/],
    ['complete 没有数据行', { result: () => new Response('event: complete\n\n') }, /可用的配音结果/],
    ['没有音频地址', { result: () => new Response('event: complete\ndata: [{}]\n\n') }, /音频文件/],
    ['外部音频地址', { result: () => new Response('event: complete\ndata: [{"url":"http://evil.example/gradio_api/file=x"}]\n\n') }, /非本机音频/],
    ['非文件接口路径', { result: () => new Response('event: complete\ndata: [{"url":"/gradio_api/info"}]\n\n') }, /非本机音频/],
    ['音频下载失败', { audio: () => new Response('', { status: 404 }) }, /无法下载/],
    ['WAV 过小', { audio: () => new Response(new Uint8Array(43)) }, /大小超限/],
  ])('%s 时报错', async (_, overrides, message) => {
    stubVox(overrides);
    const addMedia = vi.fn(async () => 'session/x.wav');
    await expect(generateCandidate(() => baseData, addMedia, 'a', live())).rejects.toThrow(message);
    expect(addMedia).not.toHaveBeenCalled();
  });

  it('相对文件地址按本机服务解析', async () => {
    const calls = stubVox({ result: () => new Response('event: complete\ndata: [{"url":"/gradio_api/file=/tmp/rel.wav"}]\n\n') });
    await generateCandidate(() => baseData, async () => 'session/x.wav', 'a', live());
    expect(calls.at(-1)!.url).toBe(`${origin}/gradio_api/file=/tmp/rel.wav`);
  });

  it('生成期间台词或音色变化时丢弃候选', async () => {
    stubVox();
    let reads = 0;
    const read = () => reads++ === 0 ? baseData : { ...baseData, voiceInstruction: '沉稳男声' };
    await expect(generateCandidate(read, async () => 'session/x.wav', 'a', live())).rejects.toThrow(/已变化/);
  });

  it('保存素材后已取消时抛出取消原因', async () => {
    stubVox();
    const controller = new AbortController();
    const reason = new Error('取消');
    const addMedia = async () => { controller.abort(reason); return 'session/x.wav'; };
    await expect(generateCandidate(() => baseData, addMedia, 'a', controller.signal)).rejects.toBe(reason);
  });
});

describe('批量补齐缺失配音', () => {
  function project(extra: Record<string, unknown> = {}) {
    let state: Record<string, unknown> = { ...baseData, ...extra };
    return {
      read: () => state,
      set: (changes: Record<string, unknown>) => { state = { ...state, ...changes }; },
      patch: vi.fn((changes: Record<string, unknown>) => { state = { ...state, ...changes }; return true; }),
    };
  }

  it('跳过锁定区间内的台词，逐句生成并应用到画布', async () => {
    stubVox();
    const store = project({ directorEdit: { locks: [{ startMs: 3500, endMs: 4000 }] } });
    const progress = vi.fn();
    await fillMissing(store.read, store.patch, async file => `session/${file.name}`, live(), progress);
    expect(progress.mock.calls.map(call => call[0])).toEqual(['正在补齐第 1/1 句', '已补齐 1 句可编辑台词。请同步试听并核对区间。']);
    expect(store.read().segments).toEqual([expect.objectContaining({ id: 'a', audioRefOverride: 'session/voxcpm-evt_1.wav', endMs: 1500, videoStartMs: 0, videoEndMs: 3000 })]);
    expect(store.read().generatedLineTexts).toEqual({ a: '第一句' });
  });

  it('生成期间其他途径已补上的句子不再生成', async () => {
    stubVox();
    const store = project();
    const addMedia = vi.fn(async (file: File) => `session/${file.name}`);
    const progress = vi.fn((message: string) => {
      if (message.startsWith('正在补齐第 1/')) store.set({ segments: [{ id: 'b', label: '第二句', startMs: 0, endMs: 100, gapMs: 0, gain: 1, muted: false, videoStartMs: 3000, videoEndMs: 6000, audioRefOverride: 'manual.wav' }] });
    });
    await fillMissing(store.read, store.patch, addMedia, live(), progress);
    expect(addMedia).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledTimes(2);
    expect((store.read().segments as { id: string }[]).map(segment => segment.id)).toEqual(['b', 'a']);
  });

  it('没有可补齐台词时报错', async () => {
    const store = project({ directorEdit: { locks: [{ startMs: 0, endMs: 6000 }] } });
    await expect(fillMissing(store.read, store.patch, vi.fn(), live(), vi.fn())).rejects.toThrow(/没有可补齐/);
    const filled = project({ audioRef: 'main.wav', segments: baseData.rewriteLines.map(line => ({ id: line.id })) });
    await expect(fillMissing(filled.read, filled.patch, vi.fn(), live(), vi.fn())).rejects.toThrow(/没有可补齐/);
  });

  it('画布拒绝应用时报错', async () => {
    stubVox();
    const store = project();
    await expect(fillMissing(store.read, () => false, async () => 'session/x.wav', live(), vi.fn())).rejects.toThrow(/画布未应用/);
  });

  it('生成期间新增锁定时拒绝写入', async () => {
    stubVox();
    const store = project();
    const addMedia = async () => { store.set({ directorEdit: { locks: [{ startMs: 0, endMs: 1000 }] } }); return 'session/x.wav'; };
    await expect(fillMissing(store.read, store.patch, addMedia, live(), vi.fn())).rejects.toThrow(/锁定/);
    expect(store.patch).not.toHaveBeenCalled();
  });

  it('已取消时不开始生成', async () => {
    const calls = stubVox();
    const controller = new AbortController();
    const reason = new Error('取消');
    controller.abort(reason);
    const store = project();
    await expect(fillMissing(store.read, store.patch, vi.fn(), controller.signal, vi.fn())).rejects.toBe(reason);
    expect(calls).toEqual([]);
  });
});
