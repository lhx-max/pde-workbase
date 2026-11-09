import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { generateCaptions, generateDubbing, unavailableTtsProvider } from '../src/providers';
import type { DramaAudioCaption } from '../src/types';

const ENV_KEYS = ['WQ_API_KEY', 'WQ_API_BASE', 'WQ_MODEL', 'DRAMA_AUDIO_PROVIDER', 'DENSE_CAPTION_API_URL', 'DENSE_CAPTION_API_KEY', 'DUBBING_API_URL', 'DUBBING_API_KEY'] as const;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) { saved.set(key, process.env[key]); delete process.env[key]; }
});

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
});

const request = { videoRef: 'video/ep4.mp4', videoDurationMs: 12_000 };
const captions: DramaAudioCaption[] = [
  { id: 'cap-0', startMs: 0, endMs: 6_000, text: '雨夜巷口。', thumbnail: null },
  { id: 'cap-1', startMs: 6_000, endMs: 12_000, text: '人物对峙。', thumbnail: null },
];

describe('providers: 未配置明确报错（不假成功）', () => {
  it('万擎采用 chat/completions 文本信封，密钥不进入结果', async () => {
    const gateway = createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const input = JSON.parse(body);
        expect(req.url).toBe('/api/gateway/v1/endpoints/chat/completions');
        expect(req.headers.authorization).toBe('Bearer fixture-key');
        expect(input.model).toBe('fixture-model');
        expect(input.messages[1].content).toContain('雨夜巷口');
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: '雨夜里，他停下脚步。' }, finish_reason: 'stop' }] }));
      });
    });
    await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve));
    try {
      const address = gateway.address();
      if (!address || typeof address === 'string') throw new Error('listener');
      process.env.WQ_API_KEY = 'fixture-key';
      process.env.WQ_MODEL = 'fixture-model';
      process.env.WQ_API_BASE = `http://127.0.0.1:${address.port}/api/gateway/v1/endpoints/`;
      const result = await generateDubbing({ script: '草稿', captions });
      expect(result).toEqual({ provider: 'wanqing:fixture-model', doc: '雨夜里，他停下脚步。' });
      expect(JSON.stringify(result)).not.toContain('fixture-key');
    } finally {
      await new Promise<void>(resolve => gateway.close(() => resolve()));
    }
  });

  it('万擎未配置和 TTS 占位明确不可用', async () => {
    process.env.DRAMA_AUDIO_PROVIDER = 'wanqing';
    await expect(generateDubbing({ script: '草稿', captions })).rejects.toThrow('WQ_API_KEY');
    await expect(unavailableTtsProvider.synthesize({ text: '台词', voiceId: 'voice', segmentId: 's1' })).rejects.toThrow('TTS_UNAVAILABLE');
  });

  it('captions/dubbing 均抛「未配置」', async () => {
    await expect(generateCaptions(request)).rejects.toThrow('provider 未配置');
    await expect(generateDubbing({ script: null, captions: [] })).rejects.toThrow('provider 未配置');
  });
});

describe('providers: mock 显式标记', () => {
  beforeEach(() => { process.env.DRAMA_AUDIO_PROVIDER = 'mock'; });

  it('captions 确定性且按视频时长四等分', async () => {
    const first = await generateCaptions(request);
    const second = await generateCaptions(request);
    expect(first.provider).toBe('mock');
    expect(second).toEqual(first);
    expect(first.captions).toHaveLength(4);
    expect(first.captions[0]).toMatchObject({ startMs: 0, endMs: 3_000 });
    expect(first.captions[3].endMs).toBe(12_000);
  });

  it('dubbing 带台本与不带台本两种形态', async () => {
    const withScript = await generateDubbing({ script: '第一句台词', captions });
    expect(withScript.provider).toBe('mock');
    expect(withScript.doc).toContain('第一句台词');
    expect(withScript.doc).toContain('雨夜巷口。');
    const noScript = await generateDubbing({ script: null, captions });
    expect(noScript.doc).toContain('基于画面生成（mock）');
  });
});

describe('providers: HTTP 接入', () => {
  let server: Server;
  let url = '';
  let calls = 0;

  beforeEach(async () => {
    calls = 0;
    server = createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        calls += 1;
        if (!req.headers.authorization?.startsWith('Bearer test-key')) {
          res.writeHead(401).end('{}');
          return;
        }
        const payload = JSON.parse(body);
        if (req.url === '/caption') {
          if (payload.videoRef !== 'video/ep4.mp4') { res.writeHead(422).end('{}'); return; }
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ captions }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ doc: `文档：${payload.script ?? '（无台本）'}` }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address === 'string' || address === null) throw new Error('listener');
    url = `http://127.0.0.1:${address.port}`;
    process.env.DENSE_CAPTION_API_URL = `${url}/caption`;
    process.env.DENSE_CAPTION_API_KEY = 'test-key';
    process.env.DUBBING_API_URL = `${url}/dub`;
    process.env.DUBBING_API_KEY = 'test-key';
  });

  afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

  it('captions 经 HTTP 获取并保留 provider URL', async () => {
    const result = await generateCaptions(request);
    expect(result.provider).toBe(`${url}/caption`);
    expect(result.captions).toEqual(captions);
    expect(calls).toBe(1);
  });

  it('dubbing 经 HTTP 获取文档', async () => {
    const result = await generateDubbing({ script: '开场白', captions });
    expect(result.doc).toBe('文档：开场白');
  });

  it('非法响应（缺字段）明确报错', async () => {
    process.env.DENSE_CAPTION_API_URL = `${url}/empty`;
    server.close();
    const empty = createServer((_req, res) => res.writeHead(200).end('{}'));
    await new Promise<void>(resolve => empty.listen(0, '127.0.0.1', resolve));
    const address = empty.address();
    if (typeof address === 'string' || address === null) throw new Error('listener');
    process.env.DENSE_CAPTION_API_URL = `http://127.0.0.1:${address.port}/empty`;
    await expect(generateCaptions(request)).rejects.toThrow('captions');
    await new Promise<void>(resolve => empty.close(() => resolve()));
  });
});
