import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportHandoff, exportVideo } from '../src/director/director-delivery';
import { importScript, importVoice } from '../src/director/director-media';

const rendered = { numberOfChannels: 1, length: 1, sampleRate: 44_100, getChannelData: () => Float32Array.of(0.25) };

class FakeOfflineContext {
  static modes: number[] = [];
  readonly destination = {};
  async decodeAudioData() { return { duration: 60 }; }
  createBufferSource() { return { buffer: null, connect: (node: unknown) => node, start: vi.fn() }; }
  createGain() { return { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: (node: unknown) => node }; }
  async startRendering() { return rendered; }
}

const lookup = (ref: string) => `blob:${ref}`;

function stubFetch(status = 200) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => new Response(`bytes of ${url}`, { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** 解析中央目录，返回文件名与内容。 */
async function unzip(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const eocd = bytes.length - 22;
  const files = new Map<string, Uint8Array>();
  let cursor = view.getUint32(eocd + 16, true);
  for (let i = 0; i < view.getUint16(eocd + 10, true); i++) {
    const nameLength = view.getUint16(cursor + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const size = view.getUint32(cursor + 20, true);
    const offset = view.getUint32(cursor + 42, true) + 30 + nameLength;
    files.set(name, bytes.subarray(offset, offset + size));
    cursor += 46 + nameLength;
  }
  return files;
}

beforeEach(() => {
  vi.stubGlobal('OfflineAudioContext', FakeOfflineContext);
});

afterEach(async () => {
  // 等待异步派发的录制器 stop 事件，避免在全局桩还原后才触发。
  await new Promise(resolve => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
});

const draft = importScript({}, '第一句\n第二句', 6000);
const voiced = { ...draft, ...importVoice(draft, 'voice/take.wav', 6000, 6000), masterGain: 1 };

describe('剪辑交接包', () => {
  it('混音模式打包主视频、配音源、批注音频、字幕、各轨 WAV、背景音乐和工程清单', async () => {
    const fetchMock = stubFetch();
    const data = {
      ...voiced, videoRef: 'inputs/media/clip:1.mp4', directorBackgroundRef: 'music/bg.wav', directorBackgroundDurationMs: 6000,
      directorEdit: { notes: [{ id: 'n', range: { startMs: 0, endMs: 10 }, text: '', resolved: false, audioRefs: ['voice/take.wav', 'voice/note.wav', 'inputs/media/clip:1.mp4'] }] },
    };
    const files = await unzip(await exportHandoff(data, lookup, 6000, 'mix', new AbortController().signal));
    expect([...files.keys()]).toEqual([
      '主视频/clip_1.mp4', '配音源/1-take.wav', '配音源/2-note.wav', '台词.srt', '配音轨.wav',
      '背景音乐/bg.wav', '背景音乐轨.wav', '原声轨.wav', '混音.wav', '工程清单.json',
    ]);
    expect(new TextDecoder().decode(files.get('主视频/clip_1.mp4'))).toBe('bytes of blob:inputs/media/clip:1.mp4');
    expect(new TextDecoder().decode(files.get('台词.srt'))).toContain('00:00:03,000 --> 00:00:06,000\n第二句');
    expect(new TextDecoder().decode(files.get('配音轨.wav')!.subarray(0, 4))).toBe('RIFF');
    const manifest = JSON.parse(new TextDecoder().decode(files.get('工程清单.json')));
    expect(manifest).toMatchObject({ version: 1, durationMs: 6000, listenMode: 'mix', data: { videoRef: 'inputs/media/clip:1.mp4' } });
    expect(manifest.media).toEqual({
      'inputs/media/clip:1.mp4': '主视频/clip_1.mp4', 'voice/take.wav': '配音源/1-take.wav',
      'voice/note.wav': '配音源/2-note.wav', 'music/bg.wav': '背景音乐/bg.wav',
    });
    expect(fetchMock.mock.calls.every(([, init]) => init?.redirect === 'error')).toBe(true);
  });

  it('配音模式只打包配音相关文件；背景与配音同源时不重复收录', async () => {
    stubFetch();
    const data = { ...voiced, videoRef: 'inputs/media/clip.mp4', directorBackgroundRef: 'voice/take.wav', directorBackgroundDurationMs: 6000 };
    const files = await unzip(await exportHandoff(data, lookup, 6000, 'voice', new AbortController().signal));
    expect([...files.keys()]).toEqual(['主视频/clip.mp4', '配音源/1-take.wav', '台词.srt', '配音轨.wav', '背景音乐轨.wav', '工程清单.json']);
  });

  it('原声模式在有视频时导出原声轨；空工程只含清单', async () => {
    stubFetch();
    const original = await unzip(await exportHandoff({ videoRef: 'v/clip.mp4' }, lookup, 3000, 'original', new AbortController().signal));
    expect([...original.keys()]).toEqual(['主视频/clip.mp4', '原声轨.wav', '工程清单.json']);
    const empty = await unzip(await exportHandoff({ segments: 'bad' }, lookup, 3000, 'original', new AbortController().signal));
    expect([...empty.keys()]).toEqual(['工程清单.json']);
  });

  it('不安全的素材文件名被替换为 media 或转义', async () => {
    stubFetch();
    const data = { segments: [{ audioRefOverride: 'voice/..' }, { audioRefOverride: 'voice/' }, { audioRefOverride: '' }, {}], audioRef: 'a\\b' };
    const result = exportHandoff(data, lookup, 3000, 'original', new AbortController().signal);
    const files = await unzip(await result);
    expect([...files.keys()].filter(name => name.startsWith('配音源/'))).toEqual(['配音源/1-media', '配音源/2-media', '配音源/3-a_b']);
  });

  it('素材读取失败、未载入或已取消时不生成交接包', async () => {
    stubFetch(500);
    await expect(exportHandoff({ videoRef: 'v/clip.mp4' }, lookup, 3000, 'voice', new AbortController().signal)).rejects.toThrow('读取工程素材失败 HTTP 500');
    await expect(exportHandoff({ videoRef: 'v/clip.mp4' }, () => undefined, 3000, 'voice', new AbortController().signal)).rejects.toThrow(/素材尚未载入/);
    stubFetch();
    const controller = new AbortController();
    const reason = new Error('取消');
    controller.abort(reason);
    await expect(exportHandoff({}, lookup, 3000, 'voice', controller.signal)).rejects.toBe(reason);
  });
});

class FakeVideo extends EventTarget {
  muted = false;
  playsInline = false;
  preload = '';
  duration = 2;
  videoWidth = 3840;
  videoHeight = 2160;
  ended = false;
  time = 0;
  loadFails = false;
  readonly play = vi.fn(async () => {});
  readonly pause = vi.fn();
  readonly removeAttribute = vi.fn();
  readonly load = vi.fn();
  set src(_: string) { queueMicrotask(() => this.dispatchEvent(new Event(this.loadFails ? 'error' : 'loadeddata'))); }
  get currentTime() { return this.time; }
  set currentTime(value: number) { this.time = value; queueMicrotask(() => this.dispatchEvent(new Event('seeked'))); }
}

class FakeRecorder {
  static supported = 'video/mp4;codecs=avc1,mp4a.40.2';
  static emitted: Blob[] = [];
  static instances: FakeRecorder[] = [];
  static isTypeSupported(type: string) { return type === FakeRecorder.supported; }
  state = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  onstop: (() => void) | null = null;
  readonly start = vi.fn(() => { this.state = 'recording'; });
  // 与浏览器一致：状态同步变为 inactive，dataavailable/stop 事件异步派发。
  readonly stop = vi.fn(() => {
    this.state = 'inactive';
    setTimeout(() => {
      for (const data of FakeRecorder.emitted) this.ondataavailable?.({ data });
      this.onstop?.();
    }, 0);
  });
  constructor(readonly stream: unknown, readonly options: Record<string, unknown>) { FakeRecorder.instances.push(this); }
}

function setupBrowser(options: { context?: boolean; onTick?: (count: number) => void } = {}) {
  const video = new FakeVideo();
  const ctx = {
    font: '', textAlign: '', lineWidth: 0, lineJoin: '', strokeStyle: '', fillStyle: '',
    drawImage: vi.fn(), strokeText: vi.fn(), fillText: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 100 }),
  };
  const videoTrack = { stop: vi.fn() };
  const added: { stop: () => void }[] = [];
  const stream = { addTrack: vi.fn((track: { stop: () => void }) => added.push(track)), getTracks: () => [videoTrack, ...added] };
  const canvas = { width: 0, height: 0, getContext: vi.fn(() => options.context === false ? null : ctx), captureStream: vi.fn(() => stream) };
  vi.stubGlobal('document', { createElement: vi.fn((tag: string) => tag === 'video' ? video : canvas) });
  const audioTrack = { stop: vi.fn() };
  const bufferSource = { buffer: null as unknown, connect: vi.fn(), start: vi.fn() };
  const audio = {
    resume: vi.fn(async () => {}), close: vi.fn(async () => {}),
    createMediaStreamDestination: () => ({ stream: { getAudioTracks: () => [audioTrack] } }),
    createBufferSource: () => bufferSource,
  };
  vi.stubGlobal('AudioContext', vi.fn(function AudioContext() { return audio; }));
  FakeRecorder.emitted = [new Blob([]), new Blob(['mp4-data'])];
  FakeRecorder.instances = [];
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  let ticks = 0;
  const frames = new Map<number, ReturnType<typeof setTimeout>>();
  let nextFrame = 1;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: (time: number) => void) => {
    const id = nextFrame++;
    frames.set(id, setTimeout(() => { frames.delete(id); ticks++; options.onTick?.(ticks); video.time += 0.5; callback(0); }, 0));
    return id;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { clearTimeout(frames.get(id)); frames.delete(id); }));
  stubFetch();
  return { video, ctx, canvas, audio, audioTrack, videoTrack, bufferSource };
}

const captionData = {
  videoRef: 'video/main.mp4', masterGain: 1,
  rewriteLines: [
    { id: 'a', text: '第一句', videoStartMs: 0, videoEndMs: 1000 },
    { id: 'b', text: '这是一句非常非常长的字幕需要自动换成两行显示', videoStartMs: 1000, videoEndMs: 2000 },
  ],
};

describe('导出 MP4', () => {
  it('浏览器不支持 MP4 录制或缺少视频源时直接拒绝', async () => {
    const signal = new AbortController().signal;
    await expect(exportVideo(captionData, 'blob:v', lookup, { startMs: 0, endMs: 1000 }, 'original', false, signal, () => {})).rejects.toThrow(/无法导出 MP4/);
    setupBrowser();
    FakeRecorder.supported = 'none';
    await expect(exportVideo(captionData, 'blob:v', lookup, { startMs: 0, endMs: 1000 }, 'original', false, signal, () => {})).rejects.toThrow(/无法导出 MP4/);
    FakeRecorder.supported = 'video/mp4;codecs=avc1.420028,mp4a.40.2';
    await expect(exportVideo(captionData, '', lookup, { startMs: 0, endMs: 1000 }, 'original', false, signal, () => {})).rejects.toThrow(/无法导出 MP4/);
    FakeRecorder.supported = 'video/mp4;codecs=avc1,mp4a.40.2';
  });

  it('按 1080p 上限缩放画布，逐帧绘制字幕并汇报进度，最后释放资源', async () => {
    const { video, ctx, canvas, audio, audioTrack, videoTrack, bufferSource } = setupBrowser();
    const progress: number[] = [];
    const blob = await exportVideo(captionData, 'blob:video', lookup, { startMs: 0, endMs: 5000 }, 'original', true, new AbortController().signal, value => progress.push(value));
    expect(blob.type).toBe('video/mp4');
    expect(await blob.text()).toBe('mp4-data');
    expect([canvas.width, canvas.height]).toEqual([1920, 1080]);
    expect(progress).toEqual([0, 25, 50, 75, 100]);
    const recorder = FakeRecorder.instances[0]!;
    expect(recorder.options).toEqual({ mimeType: 'video/mp4;codecs=avc1,mp4a.40.2', videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 160_000 });
    expect(recorder.start).toHaveBeenCalledWith(1000);
    expect(bufferSource.buffer).toBe(rendered);
    expect(bufferSource.start).toHaveBeenCalledOnce();
    const captions = ctx.fillText.mock.calls.map(call => call[0]);
    expect(captions).toContain('第一句');
    expect(captions).toContain('这是一句非常非常长的字幕需要自动');
    expect(captions).toContain('换成两行显示');
    expect(ctx.strokeText).toHaveBeenCalledTimes(ctx.fillText.mock.calls.length);
    expect(video).toMatchObject({ muted: true, playsInline: true, preload: 'auto' });
    expect(video.pause).toHaveBeenCalled();
    expect(video.removeAttribute).toHaveBeenCalledWith('src');
    expect(video.load).toHaveBeenCalled();
    expect(audioTrack.stop).toHaveBeenCalled();
    expect(videoTrack.stop).toHaveBeenCalled();
    expect(audio.resume).toHaveBeenCalled();
    expect(audio.close).toHaveBeenCalled();
  });

  it('从中间开始时先跳转视频；关闭字幕时不绘制文字', async () => {
    const { video, ctx, canvas } = setupBrowser();
    video.videoWidth = 1001;
    video.videoHeight = 701;
    const progress: number[] = [];
    await exportVideo(captionData, 'blob:video', lookup, { startMs: 1000, endMs: 2000 }, 'original', false, new AbortController().signal, value => progress.push(value));
    expect([canvas.width, canvas.height]).toEqual([1000, 700]);
    expect(progress).toEqual([0, 50, 100]);
    expect(ctx.fillText).not.toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalled();
  });

  it('视频结束时即使未到区间终点也停止录制', async () => {
    const { video } = setupBrowser({ onTick: () => { video.ended = true; } });
    const progress: number[] = [];
    await exportVideo(captionData, 'blob:video', lookup, { startMs: 0, endMs: 2000 }, 'original', false, new AbortController().signal, value => progress.push(value));
    expect(progress).toEqual([0, 25]);
  });

  it('视频无法载入、画布不可用、播放失败或没有录到数据时报错并清理', async () => {
    const signal = new AbortController().signal;
    let browser = setupBrowser();
    browser.video.loadFails = true;
    await expect(exportVideo(captionData, 'blob:v', lookup, { startMs: 0, endMs: 2000 }, 'original', false, signal, () => {})).rejects.toThrow('导出时无法读取视频画面。');
    expect(browser.audio.close).toHaveBeenCalled();

    browser = setupBrowser({ context: false });
    await expect(exportVideo(captionData, 'blob:v', lookup, { startMs: 0, endMs: 2000 }, 'original', false, signal, () => {})).rejects.toThrow('浏览器无法创建视频导出画布。');

    browser = setupBrowser();
    browser.video.play.mockRejectedValueOnce(new Error('autoplay'));
    await expect(exportVideo(captionData, 'blob:v', lookup, { startMs: 0, endMs: 2000 }, 'original', false, signal, () => {})).rejects.toThrow('录制 MP4 失败。');

    browser = setupBrowser();
    FakeRecorder.emitted = [];
    await expect(exportVideo(captionData, 'blob:v', lookup, { startMs: 0, endMs: 2000 }, 'original', false, signal, () => {})).rejects.toThrow('浏览器未生成 MP4 数据。');
  });

  it('录制中取消时停止录制器并抛出取消原因', async () => {
    const controller = new AbortController();
    const reason = new Error('取消导出');
    const browser = setupBrowser({ onTick: count => { if (count === 2) controller.abort(reason); } });
    await expect(exportVideo(captionData, 'blob:v', lookup, { startMs: 0, endMs: 2000 }, 'original', false, controller.signal, () => {})).rejects.toBe(reason);
    expect(FakeRecorder.instances[0]!.stop).toHaveBeenCalled();
    expect(browser.videoTrack.stop).toHaveBeenCalled();
    expect(browser.audio.close).toHaveBeenCalled();
  });

  it('开始前已取消时不加载视频', async () => {
    const browser = setupBrowser();
    const controller = new AbortController();
    const reason = new Error('已取消');
    controller.abort(reason);
    await expect(exportVideo(captionData, 'blob:v', lookup, { startMs: 0, endMs: 2000 }, 'original', false, controller.signal, () => {})).rejects.toBe(reason);
    expect(FakeRecorder.instances).toEqual([]);
    expect(browser.audio.close).toHaveBeenCalled();
  });
});
