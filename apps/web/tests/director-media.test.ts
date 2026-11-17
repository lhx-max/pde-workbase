import { describe, expect, it } from 'vitest';
import { deliveryIssues, encodeWav, exportSubtitles, importScript, importVoice } from '../app/session-apps/director-media';

describe('director workbench media', () => {
  it('imports playable lines and binds a timed whole take without losing the video clock', async () => {
    const draft = importScript({}, '第一句\n\n第二句', 6000);
    const result = { ...draft, ...importVoice(draft, 'outputs/voice/take.wav', 5200, 6000) };
    expect(result.segments).toEqual([
      expect.objectContaining({ startMs: 0, endMs: 3000, videoStartMs: 0, videoEndMs: 3000 }),
      expect.objectContaining({ startMs: 3000, endMs: 5200, videoStartMs: 3000, videoEndMs: 6000 }),
    ]);
    expect(deliveryIssues(result, 6000)).toEqual(['2 句区间未确认']);
    expect(await exportSubtitles(result, 6000).text()).toContain('00:00:03,000 --> 00:00:06,000\n第二句');
  });

  it('encodes correct PCM sample range and stereo layout', async () => {
    const channels = [Float32Array.of(-1, 0.25), Float32Array.of(1, -0.25)];
    const audio = { numberOfChannels: 2, length: 2, sampleRate: 44100, getChannelData: (i: number) => channels[i] } as AudioBuffer;
    const bytes = await encodeWav(audio).arrayBuffer();
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF');
    const header = new DataView(bytes);
    expect(header.getUint32(40, true)).toBe(8);
    expect(Array.from({ length: 4 }, (_, index) => header.getInt16(44 + index * 2, true))).toEqual([-32768, 32767, 8192, -8192]);
  });
});
