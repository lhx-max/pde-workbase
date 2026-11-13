import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateVideoRewrite } from '../src/providers';
import { rewrite } from '../src/ops';
import { DEFAULT_REWRITE_PROMPT, REWRITE_BODY_MAX_BYTES, validateRewriteLines, validateRewriteRequest, type VideoRewriteRequest } from '../src/rewrite';

const image = `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 224, 0, 2, 255, 217]).toString('base64')}`;
const input: VideoRewriteRequest = { script: '原稿', prompt: DEFAULT_REWRITE_PROMPT, videoRef: 'inputs/video.mp4', videoDurationMs: 4000, frames: [{ atMs: 0, image }, { atMs: 2000, image }] };
const lines = [{ id: 'line-1', text: '改写台词', videoStartMs: 0, videoEndMs: 2000 }, { id: 'line-2', text: '第二段', videoStartMs: 2000, videoEndMs: 4000 }];
const observations = [{ atMs: 0, ocr: '帧内字幕', visual: '画面描述一' }, { atMs: 2000, ocr: '', visual: '画面描述二' }];
let server: Server;
let base: string;
let requests: { path: string | undefined; body: Record<string, any>; authorization: string | undefined }[];
let visionOutput: Record<string, unknown>;
let textOutput: Record<string, unknown>;
let redirect: boolean;

beforeEach(async () => {
  requests = [];
  visionOutput = { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ frames: observations }) } }] };
  textOutput = { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ lines }) } }] };
  redirect = false;
  server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    requests.push({ path: req.url, body, authorization: req.headers.authorization });
    if (redirect) { res.writeHead(302, { location: `${base}/unexpected` }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body.model === 'fixture-vision' ? visionOutput : textOutput));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('fixture 未返回 loopback 地址');
  base = `http://127.0.0.1:${address.port}/v1`;
  vi.stubEnv('WQ_API_BASE', base);
  vi.stubEnv('WQ_API_KEY', 'fixture-key');
  vi.stubEnv('WQ_VISION_MODEL', 'fixture-vision');
  vi.stubEnv('WQ_MODEL', 'fixture-text-only');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe('generateVideoRewrite', () => {
  it('视觉步只读帧 OCR/视觉信息，文本步用观测改写，两段调用严格结构', async () => {
    const result = await generateVideoRewrite(input);
    expect(result).toEqual({
      provider: 'wanqing:fixture-text-only',
      visionProvider: 'wanqing:fixture-vision',
      observations,
      lines,
      doc: '改写台词\n第二段',
    });
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.path).toBe('/v1/chat/completions');
      expect(request.authorization).toBe('Bearer fixture-key');
      expect(request.body.response_format).toEqual({ type: 'json_object' });
    }
    const vision = requests[0];
    expect(vision.body.model).toBe('fixture-vision');
    expect(vision.body.messages[0].content).toContain('你是视频帧观测器，不是台词编辑');
    expect(vision.body.messages[0].content).toContain('不生成、不改写、不建议任何台词');
    expect(vision.body.messages[1].content).toEqual([
      { type: 'text', text: '视频采样帧时间戳：0ms' }, { type: 'image_url', image_url: { url: image } },
      { type: 'text', text: '视频采样帧时间戳：2000ms' }, { type: 'image_url', image_url: { url: image } },
    ]);
    expect(JSON.stringify(vision.body.messages)).not.toContain('原稿');
    expect(JSON.stringify(vision.body.messages)).not.toContain(DEFAULT_REWRITE_PROMPT);
    const text = requests[1];
    expect(text.body.model).toBe('fixture-text-only');
    expect(text.body.messages[0].content).toContain('不得直接把 ocr 文字当台词');
    expect(text.body.messages[0].content).toContain('第三人称');
    expect(text.body.messages[0].content).toContain('禁止生成角色对白');
    expect(text.body.messages[0].content).toContain('原解说稿是剧情主线与事实依据');
    expect(text.body.messages[0].content).toContain('不机械地按采样帧等分');
    expect(text.body.messages[0].content).toContain('原稿未提供');
    expect(DEFAULT_REWRITE_PROMPT).toContain('第三人称');
    expect(DEFAULT_REWRITE_PROMPT).toContain('不生成角色对白');
    expect(JSON.parse(text.body.messages[1].content)).toEqual({
      script: input.script, prompt: input.prompt, videoRef: input.videoRef, videoDurationMs: input.videoDurationMs, frameObservations: observations,
    });
    expect(JSON.stringify(result)).not.toContain('fixture-key');
  });

  it.each(['WQ_VISION_MODEL', 'WQ_MODEL', 'WQ_API_KEY'])('缺少 %s 显式不可用且不请求网络', async name => {
    vi.stubEnv(name, '');
    await expect(generateVideoRewrite(input)).rejects.toThrow('REWRITE_UNAVAILABLE');
    expect(requests).toHaveLength(0);
  });

  it.each([
    { vision: { choices: [] }, text: {} },
    { vision: { choices: [{ finish_reason: 'length', message: { content: '{}' } }] }, text: {} },
    { vision: { choices: [{ finish_reason: 'stop', message: { content: '```json\n{}\n```' } }] }, text: {} },
    { vision: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ frames: [observations[0]] }) } }] }, text: {} },
    { vision: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ frames: [{ ...observations[0], atMs: 999 }, observations[1]] }) } }] }, text: {} },
    { vision: { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ frames: [{ atMs: 0, ocr: '', visual: '' }, observations[1]] }) } }] }, text: {} },
  ])('拒绝视觉步不完整或非法响应 %#', async value => {
    visionOutput = value.vision;
    await expect(generateVideoRewrite(input)).rejects.toThrow('card.drama.audio:');
    expect(requests).toHaveLength(1);
  });

  it.each([
    { choices: [] },
    { choices: [{ finish_reason: 'length', message: { content: JSON.stringify({ lines }) } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '```json\n{}\n```' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '[]' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '{}' } }] },
  ])('拒绝文本步不完整或非法结构响应 %#', async value => {
    textOutput = value;
    await expect(generateVideoRewrite(input)).rejects.toThrow('card.drama.audio:');
    expect(requests).toHaveLength(2);
  });

  it('拒绝 provider 非法区间，不排序、不截断、不修复', async () => {
    textOutput = { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ lines: [{ ...lines[0], videoEndMs: 5000 }] }) } }] };
    await expect(generateVideoRewrite(input)).rejects.toThrow();
  });

  it('禁止重定向且不自动重试', async () => {
    redirect = true;
    await expect(generateVideoRewrite(input)).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });

  it.each(['http://user:pass@127.0.0.1/v1', 'file:///tmp/model', `${'http://127.0.0.1'}/v1?key=unsafe`])('拒绝不安全 provider URL %s', async url => {
    vi.stubEnv('WQ_API_BASE', url);
    await expect(generateVideoRewrite(input)).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });
});

describe('rewrite validation', () => {
  it.each([
    [], Array.from({ length: 81 }, () => lines[0]),
    [{ ...lines[0], videoStartMs: -1 }],
    [{ ...lines[0], videoStartMs: 0.5 }],
    [{ ...lines[0], videoEndMs: Infinity }],
    [{ ...lines[0], videoEndMs: NaN }],
    [{ ...lines[0], videoEndMs: 0 }],
    [{ ...lines[0], videoEndMs: 4001 }],
    [lines[1], lines[0]],
    [lines[0], { ...lines[1], videoStartMs: 1999 }],
    [lines[0], { ...lines[1], id: lines[0].id }],
    [{ ...lines[0], text: '' }],
    [{ ...lines[0], text: 'x'.repeat(2001) }],
    Array.from({ length: 11 }, (_, index) => ({ id: `line-${index}`, text: 'x'.repeat(2000), videoStartMs: index, videoEndMs: index + 1 })),
  ].map(value => ({ value })))('拒绝非法台词或区间 %#', ({ value }) => {
    expect(() => validateRewriteLines(value, 4000)).toThrow();
  });

  it('保留边界和邻接区间', () => {
    expect(validateRewriteLines(lines, 4000)).toEqual(lines);
  });

  it.each([
    { frames: [] }, { frames: Array.from({ length: 13 }, () => input.frames[0]) },
    { frames: [{ atMs: 4001, image }] }, { frames: [{ atMs: 0.5, image }] },
    { frames: [input.frames[1], input.frames[0]] },
    { frames: [{ atMs: 0, image: 'https://127.0.0.1/image.jpg' }] },
    { frames: [{ atMs: 0, image: 'data:image/png;base64,/9j/2Q==' }] },
    { frames: [{ atMs: 0, image: 'data:image/jpeg;base64,YWJjZA==' }] },
    { frames: [{ atMs: 0, image: `data:image/jpeg;base64,${Buffer.alloc(100_001).toString('base64')}` }] },
    { script: 'x'.repeat(20_001) }, { prompt: '' }, { videoDurationMs: Infinity },
    { excess: 'x'.repeat(REWRITE_BODY_MAX_BYTES) },
  ])('拒绝非法采样或超限请求 %#', patch => {
    expect(() => validateRewriteRequest({ ...input, ...patch })).toThrow();
  });
});

describe('rewrite handler', () => {
  const node = { id: 'rewrite-card', kind: 'card.drama.audio', x: 0, y: 0, data: { stage: 'rewrite', script: input.script, rewritePrompt: input.prompt, videoRef: input.videoRef, videoDurationMs: input.videoDurationMs, custom: 'preserved' } };
  const call = (target: typeof node, params: Record<string, unknown>) => rewrite(target, params, {} as Parameters<typeof rewrite>[2]);

  it('仅返回结果补丁、保留输入引用，不保存帧或覆盖原稿', async () => {
    const before = structuredClone(node);
    const result = await call(node, { ...input });
    expect(result).toEqual({ data: {
      rewriteLines: lines, rewriteDoc: '改写台词\n第二段', rewriteProvider: 'wanqing:fixture-text-only',
      rewriteVisionProvider: 'wanqing:fixture-vision', rewriteObservations: observations, rewriteConfirmed: false,
      rewriteInput: { script: input.script, prompt: input.prompt, videoRef: input.videoRef, videoDurationMs: input.videoDurationMs },
    } });
    expect(JSON.stringify(result)).not.toContain(image);
    expect(JSON.stringify(result)).not.toContain('fixture-key');
    expect(node).toEqual(before);
  });

  it.each([{ script: '未保存' }, { prompt: '未保存' }, { videoRef: 'inputs/other.mp4' }, { videoDurationMs: 4001 }])('拒绝未保存输入 %#', async patch => {
    await expect(call(node, { ...input, ...patch })).rejects.toThrow('已保存节点不一致');
    expect(requests).toHaveLength(0);
  });

  it('拒绝非改写卡', async () => {
    await expect(call({ ...node, data: { ...node.data, stage: 'editor' } }, { ...input })).rejects.toThrow('目标不是改写卡');
    expect(requests).toHaveLength(0);
  });
});
