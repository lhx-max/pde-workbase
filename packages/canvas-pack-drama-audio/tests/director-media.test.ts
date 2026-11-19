import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evenScript } from './fixtures';
import { estimateSpeechMs, LAYOUT } from '../src/director/layout';
import {
  audioDurationOf, deliveryIssues, download, encodeWav, exportSubtitles, exportWav, importScript, importVoice,
  linesOf, renderMix, videoDurationOf,
} from '../src/director/director-media';

type Source = { buffer: unknown; connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> };
type Gain = { gain: { setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn> }; connect: ReturnType<typeof vi.fn> };

const rendered = { numberOfChannels: 1, length: 2, sampleRate: 44_100, getChannelData: () => Float32Array.of(0.5, -0.5) };

class FakeOfflineContext {
  static instances: FakeOfflineContext[] = [];
  static bufferSeconds = 10;
  static onRender: (() => void) | undefined;
  readonly destination = { node: 'destination' };
  readonly sources: Source[] = [];
  readonly gains: Gain[] = [];
  constructor(readonly channels: number, readonly length: number, readonly sampleRate: number) {
    FakeOfflineContext.instances.push(this);
  }
  async decodeAudioData(bytes: ArrayBuffer) {
    if (new TextDecoder().decode(bytes) === 'undecodable') throw new Error('decode');
    const length = FakeOfflineContext.bufferSeconds * 1000;
    return { duration: FakeOfflineContext.bufferSeconds, numberOfChannels: 1, sampleRate: 1000, length, getChannelData: () => new Float32Array(length) };
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return { duration: length / sampleRate, stretched: true, copyToChannel: vi.fn() };
  }
  createBufferSource() {
    const source: Source = { buffer: null, connect: vi.fn((node: unknown) => node), start: vi.fn() };
    this.sources.push(source);
    return source;
  }
  createGain() {
    const gain: Gain = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn((node: unknown) => node) };
    this.gains.push(gain);
    return gain;
  }
  async startRendering() {
    FakeOfflineContext.onRender?.();
    return rendered;
  }
}

const lookup = (ref: string) => `blob:${ref}`;
const draft = evenScript('第一句\n第二句', 6000);
const voiced: Record<string, unknown> = { ...draft, ...importVoice(draft, 'voice/take.wav', 5200, 6000), masterGain: 1 };

function stubFetch(bodies: Record<string, { status?: number; body?: string }> = {}) {
  const fetchMock = vi.fn(async (url: string) => {
    const entry = bodies[url] ?? {};
    return new Response(entry.body ?? 'audio', { status: entry.status ?? 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  FakeOfflineContext.instances = [];
  FakeOfflineContext.bufferSeconds = 10;
  FakeOfflineContext.onRender = undefined;
  vi.stubGlobal('OfflineAudioContext', FakeOfflineContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('导入台词', () => {
  it('忽略空行，按字数比例安排区间，并生成合法 id', () => {
    const result = importScript({}, '  第一句 \r\n\n第二句\n', 6000);
    const each = estimateSpeechMs('第一句');
    expect(linesOf(result).map(line => [line.text, line.videoStartMs, line.videoEndMs])).toEqual([['第一句', 0, each], ['第二句', each + LAYOUT.maxGapMs, 2 * each + LAYOUT.maxGapMs]]);
    expect(linesOf(result).every(line => /^line-[0-9a-f-]+$/u.test(line.id))).toBe(true);
    expect(result).toMatchObject({ script: '第一句\n第二句', segments: [], confirmedLineIds: [], generatedLineTexts: {}, generatedLineVoices: {} });
  });

  it('行数不变时沿用区间和 id，只保留未改文本句的配音、确认与生成记录', () => {
    const [a, b] = linesOf(voiced);
    const before = {
      ...voiced, confirmedLineIds: [a!.id, b!.id],
      generatedLineTexts: { [a!.id]: '第一句', [b!.id]: '第二句' },
      generatedLineVoices: { [a!.id]: 7, [b!.id]: '男声' },
    };
    const result = importScript(before, '第一句\n第二句改', 6000);
    expect(linesOf(result).map(line => line.id)).toEqual([a!.id, b!.id]);
    expect(linesOf(result)[1]).toMatchObject({ text: '第二句改', videoStartMs: 3000, videoEndMs: 6000 });
    expect((result.segments as { id: string }[]).map(segment => segment.id)).toEqual([a!.id]);
    expect(result.confirmedLineIds).toEqual([a!.id]);
    expect(result.generatedLineTexts).toEqual({ [a!.id]: '第一句' });
    expect(result.generatedLineVoices).toEqual({});
  });

  it('行数变化时重新分配 id 并丢弃旧配音', () => {
    const result = importScript(voiced, '一\n二\n三', 6000);
    expect(linesOf(result).map(line => line.id)).not.toContain(linesOf(voiced)[0]!.id);
    expect(result.segments).toEqual([]);
  });

  it.each([
    ['空稿', '\n \n'],
    ['超过 80 行', Array.from({ length: 81 }, (_, i) => `${i}`).join('\n')],
    ['单行超 2000 字', 'a'.repeat(2001)],
    ['全文超 20000 字', Array.from({ length: 11 }, () => 'a'.repeat(1900)).join('\n')],
  ])('拒绝%s', (_, source) => {
    expect(() => importScript({}, source, 600_000)).toThrow(/1–80 行/);
  });

  it('未绑定视频（时长不足行数）时拒绝', () => {
    expect(() => importScript({}, '一\n二', 1)).toThrow(/绑定视频/);
  });
});

describe('导入配音', () => {
  it('整轨按台词区间切分，音频结束的尾句被截短', () => {
    expect(voiced.segments).toEqual([
      expect.objectContaining({ startMs: 0, endMs: 3000, videoStartMs: 0, videoEndMs: 3000, audioRefOverride: 'voice/take.wav', gain: 1, gapMs: 0, muted: false }),
      expect.objectContaining({ startMs: 3000, endMs: 5200, videoStartMs: 3000, videoEndMs: 6000 }),
    ]);
    expect(voiced).toMatchObject({ audioRef: 'voice/take.wav', durationMs: 5200 });
    const ids = linesOf(voiced).map(line => line.id);
    expect(voiced.generatedLineTexts).toEqual({ [ids[0]!]: '第一句', [ids[1]!]: '第二句' });
  });

  it('音频没覆盖到的句子不生成片段，完全没覆盖时报错', () => {
    const short = importVoice(draft, 'voice/short.wav', 2000, 6000);
    expect(short.segments).toEqual([expect.objectContaining({ endMs: 2000 })]);
    expect(() => importVoice(draft, 'voice/none.wav', 0, 6000)).toThrow(/未覆盖/);
  });

  it('逐句导入只替换该句，保留原主源、增益和留白', () => {
    const [a, b] = linesOf(voiced);
    const tuned = { ...voiced, segments: (voiced.segments as object[]).map((segment, index) => index === 1 ? { ...segment, gain: 0.4, gapMs: 200, muted: true } : segment), durationMs: 9000 };
    const result = importVoice(tuned, 'voice/line-b.wav', 1800, 6000, b!.id);
    expect(result.audioRef).toBe('voice/take.wav');
    expect(result.durationMs).toBe(9000);
    expect(result.segments).toEqual([
      expect.objectContaining({ id: a!.id, audioRefOverride: 'voice/take.wav' }),
      expect.objectContaining({ id: b!.id, startMs: 0, endMs: 1800, gain: 0.4, gapMs: 200, muted: true, audioRefOverride: 'voice/line-b.wav', videoStartMs: 3000 }),
    ]);
    expect(importVoice(draft, 'voice/line-b.wav', 1800, 6000, b!.id).audioRef).toBe('voice/line-b.wav');
  });

  it('没有台词时作为整轨导入，区间不超过视频', () => {
    expect(importVoice({}, 'voice/whole.wav', 9000, 6000).segments).toEqual([
      expect.objectContaining({ id: 'imported-track', startMs: 0, endMs: 9000, videoStartMs: 0, videoEndMs: 6000 }),
    ]);
  });

  it('无效台词或未绑定视频时报错', () => {
    expect(() => importVoice(draft, 'voice/x.wav', 1000, 6000, 'missing')).toThrow(/有效台词/);
    expect(() => importVoice(draft, 'voice/x.wav', 1000, 0)).toThrow(/绑定视频/);
  });
});

describe('交付检查', () => {
  it('列出未确认区间', () => {
    expect(deliveryIssues(voiced, 6000)).toEqual(['2 句区间未确认']);
  });

  it('列出缺配音、待更新、会截断和超出视频的问题', () => {
    const [a, b] = linesOf(voiced);
    const issues = deliveryIssues({
      ...voiced, confirmedLineIds: [a!.id, b!.id], generatedLineTexts: { [a!.id]: '旧文本' },
      segments: [{ ...(voiced.segments as object[])[0]!, endMs: 3500, videoEndMs: 3000 }],
    }, 2500);
    expect(issues).toEqual(['1 句缺配音', '1 句配音待更新', '1 句音频会截断', '存在超出视频的片段']);
  });

  it('静音或未对齐的片段不算截断', () => {
    const [a, b] = linesOf(voiced);
    const segments = (voiced.segments as object[]).map(segment => ({ ...segment, endMs: 9000 }));
    const data = { ...voiced, confirmedLineIds: [a!.id, b!.id] };
    expect(deliveryIssues({ ...data, segments: segments.map(s => ({ ...s, muted: true })) }, 6000)).toEqual([]);
    expect(deliveryIssues({ ...data, segments: segments.map(s => ({ ...s, videoStartMs: null, videoEndMs: null })) }, 6000)).toEqual([]);
  });
});

describe('WAV 与字幕编码', () => {
  it('输出正确的 RIFF 头、PCM 取值范围和立体声交错', async () => {
    const channels = [Float32Array.of(-1, 0.25, 3), Float32Array.of(1, -0.25, -3)];
    const audio = { numberOfChannels: 2, length: 3, sampleRate: 44_100, getChannelData: (i: number) => channels[i]! } as unknown as AudioBuffer;
    const blob = encodeWav(audio);
    expect(blob.type).toBe('audio/wav');
    const bytes = await blob.arrayBuffer();
    const text = new TextDecoder().decode(bytes);
    expect([text.slice(0, 4), text.slice(8, 12), text.slice(12, 16), text.slice(36, 40)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    const header = new DataView(bytes);
    expect(header.getUint32(4, true)).toBe(12 + 36);
    expect(header.getUint16(20, true)).toBe(1);
    expect(header.getUint16(22, true)).toBe(2);
    expect(header.getUint32(24, true)).toBe(44_100);
    expect(header.getUint32(28, true)).toBe(44_100 * 4);
    expect(header.getUint16(32, true)).toBe(4);
    expect(header.getUint16(34, true)).toBe(16);
    expect(header.getUint32(40, true)).toBe(12);
    expect(Array.from({ length: 6 }, (_, index) => header.getInt16(44 + index * 2, true))).toEqual([-32768, 32767, 8192, -8192, 32767, -32768]);
  });

  it('导出 SRT 字幕', async () => {
    const blob = exportSubtitles(voiced, 6000);
    expect(blob.type).toBe('text/plain;charset=utf-8');
    expect(await blob.text()).toBe('1\n00:00:00,000 --> 00:00:03,000\n第一句\n\n2\n00:00:03,000 --> 00:00:06,000\n第二句\n');
  });
});

describe('离线混音', () => {
  it('按视频时钟排程每句配音，同一音源只读取一次', async () => {
    const fetchMock = stubFetch();
    const audio = await renderMix(voiced, lookup, { startMs: 0, endMs: 6000 }, 'voice', new AbortController().signal);
    expect(audio).toBe(rendered);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('blob:voice/take.wav', expect.objectContaining({ redirect: 'error' }));
    const [context] = FakeOfflineContext.instances;
    expect([context!.channels, context!.length, context!.sampleRate]).toEqual([2, 6 * 44_100, 44_100]);
    expect(context!.sources.map(source => source.start.mock.calls[0])).toEqual([[0, 0, 3], [3, 3, 2.2]]);
    expect(context!.gains[0]!.gain.setValueAtTime).toHaveBeenCalledWith(1, 0);
  });

  it('变速片段使用保持音调的伸缩音频，并按倍率换算偏移', async () => {
    stubFetch();
    const segments = (voiced.segments as Record<string, unknown>[]).map((segment, index) => index === 1 ? { ...segment, fitSpeed: 1.25 } : segment);
    await renderMix({ ...voiced, segments }, lookup, { startMs: 0, endMs: 6000 }, 'voice', new AbortController().signal);
    const [context] = FakeOfflineContext.instances;
    const [first, second] = context!.sources;
    expect(first!.buffer).not.toMatchObject({ stretched: true });
    expect(second!.buffer).toMatchObject({ stretched: true, duration: 8 });
    expect(second!.start.mock.calls[0]![1]).toBeCloseTo(3 / 1.25, 5);
  });

  it('只渲染选中范围，并裁掉范围外和音源外的部分', async () => {
    stubFetch();
    await renderMix(voiced, lookup, { startMs: 1000, endMs: 4000 }, 'voice', new AbortController().signal);
    expect(FakeOfflineContext.instances[0]!.sources.map(source => source.start.mock.calls[0])).toEqual([[0, 1, 2], [2, 3, 1]]);
    FakeOfflineContext.bufferSeconds = 2;
    await renderMix(voiced, lookup, { startMs: 0, endMs: 6000 }, 'voice', new AbortController().signal);
    expect(FakeOfflineContext.instances[1]!.sources.map(source => source.start.mock.calls[0])).toEqual([[0, 0, 2]]);
  });

  it('混音模式叠加视频原声和背景音乐，并应用音量区域', async () => {
    const fetchMock = stubFetch();
    const data = {
      ...voiced, videoRef: 'video/main.mp4', directorBackgroundRef: 'music/bg.wav', directorBackgroundDurationMs: 6000,
      directorOriginalGain: 0.5, directorGainRegions: [{ startMs: 1000, endMs: 2000, track: 'original', gain: 0, fadeMs: 0 }],
    };
    await renderMix(data, lookup, { startMs: 0, endMs: 6000 }, 'mix', new AbortController().signal);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['blob:voice/take.wav', 'blob:music/bg.wav', 'blob:video/main.mp4']);
    const context = FakeOfflineContext.instances[0]!;
    expect(context.sources).toHaveLength(4);
    expect(context.sources[3]!.start).toHaveBeenCalledWith(0, 0);
    const original = context.gains[3]!.gain.setValueAtTime;
    expect(original.mock.calls).toEqual([[0.5, 0], [0, 1], [0.5, 2]]);
  });

  it('原声模式只读取视频，配音不参与', async () => {
    const fetchMock = stubFetch();
    await renderMix({ ...voiced, videoRef: 'video/main.mp4' }, lookup, { startMs: 2000, endMs: 3000 }, 'original', new AbortController().signal);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['blob:video/main.mp4']);
    expect(FakeOfflineContext.instances[0]!.sources[0]!.start).toHaveBeenCalledWith(0, 2);
  });

  it.each([
    [{ startMs: 0, endMs: 0 }], [{ startMs: 100, endMs: 50 }], [{ startMs: 0, endMs: 15 * 60_000 + 1 }], [{ startMs: 0, endMs: 10.5 }],
  ])('拒绝非法渲染范围 %j', async range => {
    await expect(renderMix(voiced, lookup, range, 'voice', new AbortController().signal)).rejects.toThrow(/15 分钟以内/);
  });

  it('素材未载入或读取失败时报错', async () => {
    stubFetch({ 'blob:voice/take.wav': { status: 404 } });
    await expect(renderMix(voiced, () => undefined, { startMs: 0, endMs: 6000 }, 'voice', new AbortController().signal)).rejects.toThrow('素材尚未载入：take.wav');
    await expect(renderMix(voiced, lookup, { startMs: 0, endMs: 6000 }, 'voice', new AbortController().signal)).rejects.toThrow('音频读取失败 HTTP 404');
  });

  it('视频原声无法解码时给出可操作提示；已取消时抛出取消原因', async () => {
    stubFetch({ 'blob:video/main.mp4': { body: 'undecodable' } });
    const data = { ...voiced, videoRef: 'video/main.mp4' };
    await expect(renderMix(data, lookup, { startMs: 0, endMs: 6000 }, 'mix', new AbortController().signal)).rejects.toThrow(/无法解码视频原声/);
    const controller = new AbortController();
    const reason = new Error('用户取消');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('video')) { controller.abort(reason); throw new Error('aborted'); }
      return new Response('audio');
    }));
    await expect(renderMix(data, lookup, { startMs: 0, endMs: 6000 }, 'mix', controller.signal)).rejects.toBe(reason);
  });

  it('渲染期间取消时不返回结果', async () => {
    stubFetch();
    const controller = new AbortController();
    const reason = new Error('取消');
    FakeOfflineContext.onRender = () => controller.abort(reason);
    await expect(renderMix(voiced, lookup, { startMs: 0, endMs: 6000 }, 'voice', controller.signal)).rejects.toBe(reason);
    const aborted = new AbortController();
    aborted.abort(reason);
    stubFetch();
    await expect(renderMix({ ...voiced, segments: [] }, lookup, { startMs: 0, endMs: 6000 }, 'voice', aborted.signal)).rejects.toBe(reason);
  });

  it('导出 WAV：配音模式没有片段时拒绝，否则编码渲染结果', async () => {
    stubFetch();
    await expect(exportWav({ ...voiced, segments: [] }, lookup, 6000, 'voice', new AbortController().signal)).rejects.toThrow(/尚无可导出的配音/);
    const blob = await exportWav(voiced, lookup, 6000, 'voice', new AbortController().signal);
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + 4);
  });
});

class FakeVideo {
  preload = '';
  duration = NaN;
  onloadedmetadata: (() => void) | null = null;
  onerror: (() => void) | null = null;
  removed: string[] = [];
  constructor(private readonly behavior: 'load' | 'error' | 'hang', duration: number) { this.duration = duration; }
  set src(_: string) {
    if (this.behavior === 'load') queueMicrotask(() => this.onloadedmetadata?.());
    if (this.behavior === 'error') queueMicrotask(() => this.onerror?.());
  }
  removeAttribute(name: string) { this.removed.push(name); }
}

describe('浏览器媒体时长', () => {
  function stubVideo(behavior: 'load' | 'error' | 'hang', duration = 12.3456) {
    const video = new FakeVideo(behavior, duration);
    vi.stubGlobal('document', { createElement: vi.fn(() => video) });
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => 'blob:video'), revokeObjectURL: revoke }));
    return { video, revoke };
  }
  const file = new File(['x'], 'clip.mp4');

  it('读取视频元数据得到毫秒时长，并释放对象 URL', async () => {
    const { video, revoke } = stubVideo('load');
    await expect(videoDurationOf(file)).resolves.toBe(12346);
    expect(video.preload).toBe('metadata');
    expect(video.removed).toEqual(['src']);
    expect(video.onloadedmetadata).toBeNull();
    expect(revoke).toHaveBeenCalledWith('blob:video');
  });

  it('无效时长、解码错误和超时分别报错', async () => {
    stubVideo('load', Infinity);
    await expect(videoDurationOf(file)).rejects.toThrow('无法识别视频时长');
    stubVideo('load', 0);
    await expect(videoDurationOf(file)).rejects.toThrow('无法识别视频时长');
    stubVideo('error');
    await expect(videoDurationOf(file)).rejects.toThrow('当前浏览器无法读取此视频');
    vi.useFakeTimers();
    const { revoke } = stubVideo('hang');
    const pending = videoDurationOf(file);
    const assertion = expect(pending).rejects.toThrow('视频读取超时');
    await vi.advanceTimersByTimeAsync(12_000);
    await assertion;
    expect(revoke).toHaveBeenCalled();
  });

  it('解码音频得到时长，至少 1 毫秒，并总是关闭上下文', async () => {
    const close = vi.fn(async () => {});
    let duration = 1.2344;
    vi.stubGlobal('AudioContext', class {
      close = close;
      async decodeAudioData() { if (duration < 0) throw new Error('bad'); return { duration }; }
    });
    await expect(audioDurationOf(new File(['abc'], 'a.wav'))).resolves.toBe(1234);
    duration = 0;
    await expect(audioDurationOf(new File(['abc'], 'a.wav'))).resolves.toBe(1);
    duration = -1;
    await expect(audioDurationOf(new File(['abc'], 'a.wav'))).rejects.toThrow('当前浏览器无法解码此音频');
    expect(close).toHaveBeenCalledTimes(3);
  });

  it('超过 64 MB 的音频不解码', async () => {
    const context = vi.fn();
    vi.stubGlobal('AudioContext', context);
    await expect(audioDurationOf({ size: 64 * 1024 * 1024 + 1 } as File)).rejects.toThrow(/64 MB/);
    expect(context).not.toHaveBeenCalled();
  });

  it('下载时点击临时链接，稍后释放对象 URL', () => {
    vi.useFakeTimers();
    const link = { href: '', download: '', click: vi.fn() };
    vi.stubGlobal('document', { createElement: vi.fn(() => link) });
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: vi.fn(() => 'blob:out'), revokeObjectURL: revoke }));
    download(new Blob(['x']), '配音.wav');
    expect(link).toMatchObject({ href: 'blob:out', download: '配音.wav' });
    expect(link.click).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revoke).toHaveBeenCalledWith('blob:out');
  });
});
