import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dubbingCounts, lineGenerationCurrent, voiceKeyOf, voiceReferenceOf } from '../src/dubbing';
import { fillMissing, generateCandidate } from '../src/director/local-voice';

const origin = 'http://127.0.0.1:8808';
const reference = { lineId: 'a', audioRef: 'session/a.wav', startMs: 0, endMs: 2000, text: '第一句', voice: '温柔女声' };
const lines = [
  { id: 'a', text: '第一句', videoStartMs: 0, videoEndMs: 2000 },
  { id: 'b', text: '第二句', videoStartMs: 2000, videoEndMs: 4000 },
  { id: 'c', text: '第三句', videoStartMs: 4000, videoEndMs: 6000 },
];
const take = (id: string) => ({ id, label: id, startMs: 0, endMs: 1500, gapMs: 0, gain: 1, muted: false, videoStartMs: 0, videoEndMs: 2000, audioRefOverride: `session/${id}.wav` });

describe('音色基准与音色标识', () => {
  it('只接受完整有效的基准', () => {
    expect(voiceReferenceOf({ voiceReference: reference })).toEqual(reference);
    expect(voiceReferenceOf({ voiceReference: { ...reference, endMs: 0 } })).toBeNull();
    expect(voiceReferenceOf({ voiceReference: { ...reference, text: ' ' } })).toBeNull();
    expect(voiceReferenceOf({ voiceReference: null })).toBeNull();
    expect(voiceReferenceOf({})).toBeNull();
  });

  it('没有基准时沿用音色描述；有基准时包含基准音频，单独音色也计入', () => {
    expect(voiceKeyOf({ voiceInstruction: '温柔女声' }, 'b')).toBe('温柔女声');
    const data = { voiceReference: reference, lineVoiceInstructions: { c: '激动一点' } };
    expect(voiceKeyOf(data, 'b')).toBe('音色基准 session/a.wav#0-2000');
    expect(voiceKeyOf(data, 'c')).toBe('音色基准 session/a.wav#0-2000 · 激动一点');
    expect(voiceKeyOf(data, 'a')).toBe('温柔女声');
  });

  it('设基准后其他已配音句子变为待更新，基准句保持当前', () => {
    const data = {
      voiceInstruction: '温柔女声', rewriteLines: lines, segments: [take('a'), take('b')],
      generatedLineTexts: { a: '第一句', b: '第二句' }, generatedLineVoices: { a: '温柔女声', b: '温柔女声' },
    };
    expect(dubbingCounts(data)).toMatchObject({ current: 2, stale: 0 });
    const referenced = { ...data, voiceReference: reference };
    expect(lineGenerationCurrent(referenced, 'a', '第一句')).toBe(true);
    expect(lineGenerationCurrent(referenced, 'b', '第二句')).toBe(false);
    expect(dubbingCounts(referenced)).toMatchObject({ current: 1, stale: 1, missing: 1 });
  });
});

describe('按音色基准生成', () => {
  let bodies: unknown[][] = [];
  let uploads = 0;
  beforeEach(() => {
    bodies = [];
    uploads = 0;
    vi.stubGlobal('location', { hostname: '127.0.0.1' });
    const buffer = { sampleRate: 1000, length: 3000, numberOfChannels: 1, duration: 1.2, getChannelData: () => new Float32Array(3000) };
    vi.stubGlobal('AudioContext', class { async decodeAudioData() { return buffer; } async close() {} });
    vi.stubGlobal('AudioBuffer', class {
      length: number; numberOfChannels: number; sampleRate: number; private data: Float32Array[];
      constructor(options: { length: number; numberOfChannels: number; sampleRate: number }) {
        this.length = options.length; this.numberOfChannels = options.numberOfChannels; this.sampleRate = options.sampleRate;
        this.data = Array.from({ length: options.numberOfChannels }, () => new Float32Array(options.length));
      }
      copyToChannel(source: Float32Array, channel: number) { this.data[channel]!.set(source); }
      getChannelData(channel: number) { return this.data[channel]!; }
    });
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${origin}/gradio_api/info`) return Response.json({ named_endpoints: { '/generate': {} } });
      if (url === `${origin}/gradio_api/upload`) { uploads++; return Response.json(['/tmp/gradio/voice-reference.wav']); }
      if (url === `${origin}/gradio_api/call/generate`) { bodies.push(JSON.parse(String(init?.body)).data); return Response.json({ event_id: `e${bodies.length}` }); }
      if (url.startsWith(`${origin}/gradio_api/call/generate/`)) return new Response(`event: complete\ndata: [{"url":"${origin}/gradio_api/file=/tmp/out.wav"}]\n\n`);
      return new Response(new Uint8Array(200));
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const base = (extra: Record<string, unknown> = {}) => ({
    videoDurationMs: 6000, videoRef: 'video.mp4', voiceInstruction: '温柔女声', rewriteLines: lines,
    segments: [take('a')], generatedLineTexts: { a: '第一句' }, generatedLineVoices: { a: '温柔女声' }, voiceReference: reference, ...extra,
  });
  const resolve = (ref: string) => `blob:${ref}`;
  const signal = () => new AbortController().signal;
  let saved = 0;
  const addMedia = async () => `session/new-${++saved}.wav`;

  it('没有单独音色的句子克隆基准：上传参考音频并带参考文字', async () => {
    const data = base();
    const candidate = await generateCandidate(() => data, addMedia, 'b', signal(), resolve);
    expect(bodies[0]).toEqual(['第二句', '', { path: '/tmp/gradio/voice-reference.wav', meta: { _type: 'gradio.FileData' }, orig_name: 'voice-reference.wav' }, true, '第一句', 2, false, false, 10, 42]);
    expect(candidate.voice).toBe('音色基准 session/a.wav#0-2000');
  });

  it('单独设了音色的句子以基准为参考，按描述调整语气', async () => {
    const data = base({ lineVoiceInstructions: { c: '激动一点' } });
    await generateCandidate(() => data, addMedia, 'c', signal(), resolve);
    expect(bodies[0]!.slice(1, 5)).toEqual(['激动一点', expect.objectContaining({ path: '/tmp/gradio/voice-reference.wav' }), false, '']);
  });

  it('基准句自身不带参考音频生成', async () => {
    const data = base();
    await generateCandidate(() => data, addMedia, 'a', signal(), resolve);
    expect(bodies[0]!.slice(1, 4)).toEqual(['温柔女声', null, false]);
  });

  it('基准音频在当前会话不可用时提示恢复素材', async () => {
    const data = base({ voiceReference: { ...reference, audioRef: 'session/other.wav' } });
    await expect(generateCandidate(() => data, addMedia, 'b', signal())).rejects.toThrow('请先恢复会话素材');
  });

  it('基准太短时拒绝', async () => {
    const data = base({ voiceReference: { ...reference, audioRef: 'session/short.wav', endMs: 300 } });
    await expect(generateCandidate(() => data, addMedia, 'b', signal(), resolve)).rejects.toThrow('至少需要 0.5 秒');
  });

  it('批量更新时重新生成待更新的句子，同一基准只上传一次', async () => {
    let data: Record<string, unknown> = base({
      voiceReference: { ...reference, audioRef: 'session/a2.wav' },
      segments: [take('a'), take('b')], generatedLineTexts: { a: '第一句', b: '第二句' }, generatedLineVoices: { a: '温柔女声', b: '温柔女声' },
    });
    const patch = (changes: Record<string, unknown>) => { data = { ...data, ...changes }; return true; };
    const messages: string[] = [];
    await fillMissing(() => data, patch, addMedia, signal(), message => messages.push(message), { resolve, stale: true });
    expect(bodies.map(body => body[0])).toEqual(['第二句', '第三句']);
    expect(uploads).toBe(1);
    expect(dubbingCounts(data)).toMatchObject({ current: 3, stale: 0, missing: 0 });
    expect(messages.at(-1)).toContain('已更新 2 句');
  });

  it('重新生成音频不在当前会话的句子，已载入的保持不动', async () => {
    let data: Record<string, unknown> = base({ voiceReference: null, segments: [take('a'), take('b'), take('c')],
      generatedLineTexts: { a: '第一句', b: '第二句', c: '第三句' }, generatedLineVoices: { a: '温柔女声', b: '温柔女声', c: '温柔女声' } });
    const loaded = (ref: string) => ref === 'session/a.wav' ? 'blob:a' : undefined;
    const patch = (changes: Record<string, unknown>) => { data = { ...data, ...changes }; return true; };
    const messages: string[] = [];
    await fillMissing(() => data, patch, addMedia, signal(), message => messages.push(message), { resolve: loaded, offline: true });
    expect(bodies.map(body => body[0])).toEqual(['第二句', '第三句']);
    expect(messages.at(-1)).toContain('已重新生成 2 句');
  });
});
