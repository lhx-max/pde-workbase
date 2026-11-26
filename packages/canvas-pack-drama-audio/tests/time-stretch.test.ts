import { describe, expect, it } from 'vitest';
import { stretchBuffer, stretchChannels } from '../src/director/time-stretch';

const RATE = 16_000;
function sine(frequency: number, seconds: number, phase = 0) {
  return Float32Array.from({ length: Math.round(RATE * seconds) }, (_, i) => Math.sin(2 * Math.PI * frequency * i / RATE + phase));
}
/** 用过零次数估算中段频率。 */
function frequencyOf(samples: Float32Array) {
  const from = Math.floor(samples.length * 0.2), to = Math.floor(samples.length * 0.8);
  let crossings = 0;
  for (let i = from + 1; i < to; i++) if ((samples[i - 1]! < 0) !== (samples[i]! < 0)) crossings++;
  return crossings / 2 / ((to - from) / RATE);
}

describe('保持音调的变速', () => {
  it.each([1.25, 1.1, 0.8])('倍率 %s 改变时长但音调不变', rate => {
    const [out] = stretchChannels([sine(440, 1)], RATE, rate);
    expect(out!.length).toBe(Math.round(RATE / rate));
    expect(Math.abs(frequencyOf(out!) - 440)).toBeLessThan(440 * 0.04);
  });

  it('倍率为 1 时原样复制', () => {
    const input = sine(220, 0.5);
    const [out] = stretchChannels([input], RATE, 1);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it('多声道共用同一组偏移，长度一致且保持同步', () => {
    const left = sine(300, 1);
    const [a, b] = stretchChannels([left, left.slice()], RATE, 1.2);
    expect(a!.length).toBe(b!.length);
    expect(Array.from(a!.subarray(1000, 1100))).toEqual(Array.from(b!.subarray(1000, 1100)));
  });

  it('不足一帧的片段直接重采样，非法倍率报错', () => {
    const [out] = stretchChannels([new Float32Array([0, 1, 0, -1])], RATE, 2);
    expect(out!.length).toBe(2);
    expect(stretchChannels([], RATE, 1.2)).toEqual([]);
    expect(() => stretchChannels([sine(440, 0.1)], RATE, 0)).toThrow('变速倍率无效');
  });

  it('伸缩 AudioBuffer 时在同一上下文创建新 buffer', () => {
    const data = sine(440, 0.5);
    const source = { numberOfChannels: 1, sampleRate: RATE, length: data.length, getChannelData: () => data } as unknown as AudioBuffer;
    const created: { channels: number; length: number; rate: number; copied: Float32Array[] }[] = [];
    const context = {
      createBuffer(channels: number, length: number, rate: number) {
        const entry = { channels, length, rate, copied: [] as Float32Array[] };
        created.push(entry);
        return { copyToChannel: (channel: Float32Array) => entry.copied.push(channel) };
      },
    } as unknown as BaseAudioContext;
    stretchBuffer(context, source, 1.25);
    expect(created).toEqual([{ channels: 1, length: Math.round(data.length / 1.25), rate: RATE, copied: [expect.any(Float32Array)] }]);
  });
});
