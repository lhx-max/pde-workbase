import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPeakReader, extractPeaks, waveformPath } from '../src/director/waveform';

describe('波形峰值提取', () => {
  it('保留脉冲与双声道极值，不对静音归一化', () => {
    const result = extractPeaks([new Float32Array([0, .5, 0, 0]), new Float32Array([0, 0, -.8, 0])], 4, 2);
    expect(result.durationMs).toBe(1000);
    expect([...result.max]).toEqual([.5, 0]);
    expect(result.min[1]).toBeCloseTo(-.8);
    expect([...extractPeaks([new Float32Array(10)], 10).max]).toEqual(Array(10).fill(0));
  });

  it('忽略非有限采样，空音频返回零长度', () => {
    const result = extractPeaks([Float32Array.of(NaN, Infinity, -0.25, 0.75)], 2, 2);
    expect([...result.max]).toEqual([0, 0.75]);
    expect([...result.min]).toEqual([0, -0.25]);
    expect(extractPeaks([], 44_100)).toEqual({ durationMs: 0, min: new Float32Array(0), max: new Float32Array(0) });
  });
});

describe('波形路径', () => {
  it('按源偏移取样，并省略静音尾部和文件之外的数据', () => {
    const peaks = extractPeaks([new Float32Array([1, 0, .5, 0])], 4, 4);
    expect(waveformPath(peaks, 500, 500, 250, 1, 2)).toBe('M0.0,27.0V50.0');
    expect(waveformPath(peaks, 1100, 500, 500)).toBe('');
    expect(waveformPath(peaks, 0, 0, 0)).toBe('');
    expect(waveformPath({ durationMs: 0, min: new Float32Array(0), max: new Float32Array(0) }, 0, 100, 100)).toBe('');
  });

  it('增益放大波形但截在画布内，负偏移的部分留空', () => {
    const peaks = extractPeaks([Float32Array.of(0.8, -0.8)], 2, 2);
    expect(waveformPath(peaks, 0, 1000, 1000, 2, 2)).toBe('M0.0,4.0V50.0M500.0,50.0V96.0');
    expect(waveformPath(peaks, -500, 1000, 1000, 1, 2)).toBe('M500.0,13.2V50.0');
  });
});

class FakeOfflineContext {
  static fail = false;
  async decodeAudioData(bytes: ArrayBuffer) {
    if (FakeOfflineContext.fail) throw new Error('bad audio');
    const samples = new Float32Array(bytes.byteLength).fill(0.5);
    return { numberOfChannels: 2, sampleRate: 1000, getChannelData: () => samples };
  }
}

describe('峰值读取队列', () => {
  beforeEach(() => {
    FakeOfflineContext.fail = false;
    vi.stubGlobal('OfflineAudioContext', FakeOfflineContext);
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('解码音源得到峰值，同一 URL 复用缓存', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(500)));
    vi.stubGlobal('fetch', fetchMock);
    const read = createPeakReader();
    const first = read('blob:a');
    expect(read('blob:a')).toBe(first);
    const peaks = await first;
    expect(peaks.durationMs).toBe(500);
    expect(peaks.max[0]).toBe(0.5);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('一次只解码一个音源，前一个失败也不阻塞后续', async () => {
    let release: (response: Response) => void = () => {};
    const fetchMock = vi.fn((url: string) => url === 'blob:slow'
      ? new Promise<Response>(resolve => { release = resolve; })
      : Promise.resolve(new Response(new Uint8Array(10))));
    vi.stubGlobal('fetch', fetchMock);
    const read = createPeakReader();
    const slow = read('blob:slow');
    const fast = read('blob:fast');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['blob:slow']);
    release(new Response('', { status: 404 }));
    await expect(slow).rejects.toThrow('音源读取失败（404）');
    await expect(fast).resolves.toMatchObject({ durationMs: 10 });
  });

  it('失败的请求从缓存移除，可以重试', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(4))));
    FakeOfflineContext.fail = true;
    const read = createPeakReader();
    const failed = read('blob:a');
    await expect(failed).rejects.toThrow('bad audio');
    FakeOfflineContext.fail = false;
    const retry = read('blob:a');
    expect(retry).not.toBe(failed);
    await expect(retry).resolves.toMatchObject({ durationMs: 4 });
  });

  it('最多缓存 32 个音源，淘汰最早的', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array(2)));
    vi.stubGlobal('fetch', fetchMock);
    const read = createPeakReader();
    const first = read('blob:0');
    for (let i = 1; i <= 32; i++) read(`blob:${i}`);
    expect(read('blob:32')).toBe(read('blob:32'));
    expect(read('blob:0')).not.toBe(first);
    await read('blob:0');
    expect(fetchMock).toHaveBeenCalledTimes(34);
  });
});
