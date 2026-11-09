import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dramaAudioOps as ops } from '../src/ops';
import { exportPathFor, renderExportManifest, readDramaAudioData, timelineOf } from '../src/edl';
import type { DramaAudioData } from '../src/types';

type Files = {
  written: Map<string, string>;
  read(projectId: string, relative: string): Promise<string | null>;
  write(projectId: string, relative: string, content: string): Promise<void>;
};

function makeFiles(): Files {
  const written = new Map<string, string>();
  return {
    written,
    async read(_projectId, relative) { return written.get(relative) ?? null; },
    async write(_projectId, relative, content) { written.set(relative, content); },
  };
}

function nodeOf(id: string, data?: Record<string, unknown>) {
  return { id, kind: 'card.drama.audio', ...(data === undefined ? {} : { data }) };
}

/** 把动作返回的 data 补丁按平台合并语义读回（readDramaAudioData 吃节点）。 */
function dataOf(patch: { data?: Record<string, unknown> } | void): DramaAudioData {
  return readDramaAudioData({ id: 'x', kind: 'card.drama.audio', ...(patch?.data === undefined ? {} : { data: patch.data }) });
}

const ctxOf = (files: Files) => ({ projectId: 'p1', files });

async function attachNode(id: string, durationMs = 10_000, audioRef = 'voice/dub-take1.mp3') {
  const node = nodeOf(id);
  const patch = await ops.attach(node, { audioRef, durationMs }, ctxOf(makeFiles()));
  return { node: nodeOf(id, patch!.data as Record<string, unknown>), data: dataOf(patch) };
}

describe('card.drama.audio.attach', () => {
  it('初始化默认单段并保留信封外字段为 null', async () => {
    const { data } = await attachNode('a1');
    expect(data.audioRef).toBe('voice/dub-take1.mp3');
    expect(data.durationMs).toBe(10_000);
    expect(data.segments).toHaveLength(1);
    expect(data.segments[0]).toMatchObject({ id: 'seg-0', startMs: 0, endMs: 10_000, gain: 1, muted: false });
    expect(data.exportedPath).toBeNull();
  });
  it('接受显式分段并按 startMs 排序', async () => {
    const node = nodeOf('a2');
    const patch = await ops.attach(node, {
      audioRef: 'v.mp3', durationMs: 8_000,
      segments: [
        { id: 'seg-b', label: '后', startMs: 4_000, endMs: 8_000, gapMs: 0, gain: 1, muted: false },
        { id: 'seg-a', label: '前', startMs: 0, endMs: 4_000, gapMs: 120, gain: 1, muted: false },
      ],
    }, ctxOf(makeFiles()));
    const data = dataOf(patch);
    expect(data.segments.map(segment => segment.id)).toEqual(['seg-a', 'seg-b']);
  });
  it.each([
    [{ durationMs: 10_000 }, 'audioRef'],
    [{ audioRef: 'v.mp3' }, 'durationMs'],
    [{ audioRef: '/abs.mp3', durationMs: 1 }, 'audioRef'],
    [{ audioRef: 'v.mp3', durationMs: 0 }, 'durationMs'],
  ])('非法输入 %j 抛错', async (input, field) => {
    await expect(ops.attach(nodeOf('a3'), input, ctxOf(makeFiles()))).rejects.toThrow(field === 'audioRef' || field === 'durationMs' ? 'card.drama.audio' : 'card.drama.audio');
  });
});

describe('未绑源前置检查', () => {
  it.each(['upsert', 'remove', 'gap', 'gain', 'mute', 'trim', 'align', 'rebind', 'span', 'export'] as const)('%s 在未 attach 时抛错', async verb => {
    const handler = ops[verb];
    await expect(handler(nodeOf('a4'), {}, ctxOf(makeFiles()))).rejects.toThrow('尚未绑定配音源');
  });
});

describe('素材先于音频的编辑流程', () => {
  it('未生成音频也能保存稿件与绑定视频', async () => {
    const draft = await ops.script(nodeOf('draft'), { script: '真实解说词' }, ctxOf(makeFiles()));
    const bound = await ops.video(nodeOf('draft', draft!.data), { videoRef: 'inputs/video.mp4', videoDurationMs: 12_000 }, ctxOf(makeFiles()));
    expect(dataOf(bound)).toMatchObject({ audioRef: null, script: '真实解说词', videoRef: 'inputs/video.mp4', videoDurationMs: 12_000 });
    const attached = await ops.attach(nodeOf('draft', bound!.data), { audioRef: 'voice/generated.wav', durationMs: 9_000 }, ctxOf(makeFiles()));
    expect(dataOf(attached)).toMatchObject({ script: '真实解说词', videoRef: 'inputs/video.mp4', videoDurationMs: 12_000 });
  });
  it('无视频时长不能解析，不制造时间戳', async () => {
    await expect(ops.analyze(nodeOf('draft', { videoRef: 'inputs/video.mp4' }), {}, ctxOf(makeFiles()))).rejects.toThrow('时长');
  });
});

describe('分段编辑动作', () => {
  it('upsert 追加新段；重复 id 替换', async () => {
    const { node } = await attachNode('a5', 20_000);
    const added = await ops.upsert(node, { segment: { id: 'seg-line2', label: '第二句', startMs: 10_000, endMs: 15_000, gapMs: 0, gain: 1, muted: false } }, ctxOf(makeFiles()));
    let data = dataOf(added);
    expect(data.segments.map(segment => segment.id)).toEqual(['seg-0', 'seg-line2']);
    const updated = await ops.upsert(nodeOf('a5', added!.data as Record<string, unknown>), { segment: { id: 'seg-line2', label: '第二句（改）', startMs: 11_000, endMs: 15_000, gapMs: 300, gain: 0.8, muted: false } }, ctxOf(makeFiles()));
    data = dataOf(updated);
    expect(data.segments).toHaveLength(2);
    expect(data.segments.find(segment => segment.id === 'seg-line2')).toMatchObject({ label: '第二句（改）', startMs: 11_000, gapMs: 300, gain: 0.8 });
  });
  it('upsert 拒绝未知字段与非法区间', async () => {
    const { node } = await attachNode('a6');
    await expect(ops.upsert(node, { segment: { id: 's', label: 'x', startMs: 0, endMs: 100, gapMs: 0, gain: 1, muted: false, extra: 1 } }, ctxOf(makeFiles()))).rejects.toThrow('未知字段');
    await expect(ops.upsert(node, { segment: { id: 's', label: 'x', startMs: 500, endMs: 100, gapMs: 0, gain: 1, muted: false } }, ctxOf(makeFiles()))).rejects.toThrow('endMs');
  });
  it('remove 删除既有段；不存在时抛错', async () => {
    const { node } = await attachNode('a7');
    const removed = await ops.remove(node, { segmentId: 'seg-0' }, ctxOf(makeFiles()));
    expect(dataOf(removed).segments).toEqual([]);
    await expect(ops.remove(nodeOf('a7', removed!.data as Record<string, unknown>), { segmentId: 'seg-0' }, ctxOf(makeFiles()))).rejects.toThrow('不存在');
  });
  it('gap 调停顿并 clamp 边界', async () => {
    const { node } = await attachNode('a8');
    const patched = await ops.gap(node, { segmentId: 'seg-0', gapMs: 450 }, ctxOf(makeFiles()));
    expect(dataOf(patched).segments[0].gapMs).toBe(450);
    await expect(ops.gap(node, { segmentId: 'seg-0', gapMs: -1 }, ctxOf(makeFiles()))).rejects.toThrow();
    await expect(ops.gap(node, { segmentId: 'seg-0', gapMs: 60_001 }, ctxOf(makeFiles()))).rejects.toThrow();
  });
  it('gain 缺省段 ID 时改 masterGain', async () => {
    const { node } = await attachNode('a9');
    const master = await ops.gain(node, { gain: 1.5 }, ctxOf(makeFiles()));
    expect(dataOf(master).masterGain).toBe(1.5);
    const segment = await ops.gain(nodeOf('a9', master!.data as Record<string, unknown>), { segmentId: 'seg-0', gain: 0.5 }, ctxOf(makeFiles()));
    expect(dataOf(segment).segments[0].gain).toBe(0.5);
  });
  it('mute 切换静音', async () => {
    const { node } = await attachNode('a10');
    const muted = await ops.mute(node, { segmentId: 'seg-0', muted: true }, ctxOf(makeFiles()));
    expect(dataOf(muted).segments[0].muted).toBe(true);
    await expect(ops.mute(node, { segmentId: 'seg-0', muted: 'yes' }, ctxOf(makeFiles()))).rejects.toThrow('布尔值');
  });
  it('script 写入与清除', async () => {
    const { node } = await attachNode('a11');
    const set = await ops.script(node, { script: '第一句台词\n第二句台词' }, ctxOf(makeFiles()));
    expect(dataOf(set).script).toContain('第一句');
    const cleared = await ops.script(nodeOf('a11', set!.data as Record<string, unknown>), { script: null }, ctxOf(makeFiles()));
    expect(dataOf(cleared).script).toBeNull();
  });
});

describe('trim 裁剪', () => {
  it('设置窗口、单端清除、非法窗口抛错', async () => {
    const { node } = await attachNode('a12', 10_000);
    const set = await ops.trim(node, { startMs: 1_000, endMs: 9_000 }, ctxOf(makeFiles()));
    const data = dataOf(set);
    expect(data.trimStartMs).toBe(1_000);
    expect(data.trimEndMs).toBe(9_000);
    const cleared = await ops.trim(nodeOf('a12', set!.data as Record<string, unknown>), {}, ctxOf(makeFiles()));
    expect(dataOf(cleared)).toMatchObject({ trimStartMs: null, trimEndMs: null });
    await expect(ops.trim(node, { startMs: 8_000, endMs: 2_000 }, ctxOf(makeFiles()))).rejects.toThrow('startMs < endMs');
    await expect(ops.trim(node, { startMs: -1 }, ctxOf(makeFiles()))).rejects.toThrow();
  });
});

describe('v2 双轨：video / align / rebind / span', () => {
  async function dualTrackNode(id: string) {
    const node = nodeOf(id);
    const patch = await ops.attach(node, {
      audioRef: 'voice/dub.mp3', durationMs: 10_000,
      videoRef: 'video/ep3.mp4', videoDurationMs: 12_000,
      segments: [{ id: 'seg-1', label: '台词一', startMs: 0, endMs: 4_000, gapMs: 200, gain: 1, muted: false }],
    }, ctxOf(makeFiles()));
    return { node: nodeOf(id, patch!.data as Record<string, unknown>), data: dataOf(patch) };
  }

  it('attach 同步建双轨（videoRef/videoDurationMs 落 data）', async () => {
    const { data } = await dualTrackNode('a20');
    expect(data.videoRef).toBe('video/ep3.mp4');
    expect(data.videoDurationMs).toBe(12_000);
    expect(data.segments[0]).toMatchObject({ videoStartMs: null, videoEndMs: null, audioRefOverride: null });
  });

  it('video 绑定视频源后可逐段对齐/清除对齐', async () => {
    const { node } = await dualTrackNode('a21');
    const aligned = await ops.align(node, { segmentId: 'seg-1', videoStartMs: 1_000, videoEndMs: 5_400 }, ctxOf(makeFiles()));
    expect(dataOf(aligned).segments[0]).toMatchObject({ videoStartMs: 1_000, videoEndMs: 5_400 });
    const cleared = await ops.align(nodeOf('a21', aligned!.data as Record<string, unknown>), { segmentId: 'seg-1' }, ctxOf(makeFiles()));
    expect(dataOf(cleared).segments[0]).toMatchObject({ videoStartMs: null, videoEndMs: null });
  });

  it('align 未绑视频源/非法区间/不存在段均抛错', async () => {
    const { node } = await attachNode('a22', 10_000); // 单轨
    await expect(ops.align(node, { segmentId: 'seg-0', videoStartMs: 0, videoEndMs: 1_000 }, ctxOf(makeFiles()))).rejects.toThrow('尚未绑定视频源');
    const dual = await dualTrackNode('a23');
    await expect(ops.align(dual.node, { segmentId: 'seg-1', videoStartMs: 5_000, videoEndMs: 5_000 }, ctxOf(makeFiles()))).rejects.toThrow('videoStartMs < videoEndMs');
    await expect(ops.align(dual.node, { segmentId: 'ghost', videoStartMs: 0, videoEndMs: 1 }, ctxOf(makeFiles()))).rejects.toThrow('不存在');
    await expect(ops.align(dual.node, { segmentId: 'seg-1', videoStartMs: 0, videoEndMs: 12_001 }, ctxOf(makeFiles()))).rejects.toThrow('超出范围');
  });

  it('rebind 段级换配音源与恢复主源', async () => {
    const { node } = await attachNode('a24', 10_000);
    const swapped = await ops.rebind(node, { segmentId: 'seg-0', audioRef: 'voice/dub-take2.mp3' }, ctxOf(makeFiles()));
    let data = dataOf(swapped);
    expect(data.segments[0].audioRefOverride).toBe('voice/dub-take2.mp3');
    expect(timelineOf(data)[0].audioRef).toBe('voice/dub-take2.mp3'); // 时间轴解析 override
    const restored = await ops.rebind(nodeOf('a24', swapped!.data as Record<string, unknown>), { segmentId: 'seg-0', audioRef: null }, ctxOf(makeFiles()));
    data = dataOf(restored);
    expect(data.segments[0].audioRefOverride).toBeNull();
    expect(timelineOf(data)[0].audioRef).toBe('voice/dub-take1.mp3');
    await expect(ops.rebind(node, { segmentId: 'seg-0', audioRef: '../escape.mp3' }, ctxOf(makeFiles()))).rejects.toThrow('工程相对路径');
  });

  it('span 改段配音区间并保持有序；非法区间抛错', async () => {
    const { node } = await dualTrackNode('a26');
    const moved = await ops.span(node, { segmentId: 'seg-1', startMs: 6_000, endMs: 9_000 }, ctxOf(makeFiles()));
    expect(dataOf(moved).segments[0]).toMatchObject({ startMs: 6_000, endMs: 9_000 });
    await expect(ops.span(node, { segmentId: 'seg-1', startMs: 5_000, endMs: 5_000 }, ctxOf(makeFiles()))).rejects.toThrow('startMs < endMs');
    await expect(ops.span(node, { segmentId: 'seg-1', endMs: 10_001 }, ctxOf(makeFiles()))).rejects.toThrow('超出范围');
    const partial = await ops.span(node, { segmentId: 'seg-1', endMs: 8_000 }, ctxOf(makeFiles()));
    expect(dataOf(partial).segments[0]).toMatchObject({ startMs: 0, endMs: 8_000 }); // 缺省端保持原值
  });

  it('export 清单 v2 带视频源、对齐区间、换源与偏差', async () => {
    const { node } = await dualTrackNode('a27');
    const aligned = await ops.align(node, { segmentId: 'seg-1', videoStartMs: 0, videoEndMs: 4_200 }, ctxOf(makeFiles()));
    const swapped = await ops.rebind(nodeOf('a27', aligned!.data as Record<string, unknown>), { segmentId: 'seg-1', audioRef: 'voice/take2.mp3' }, ctxOf(makeFiles()));
    const files = makeFiles();
    await ops.export(nodeOf('a27', swapped!.data as Record<string, unknown>), {}, ctxOf(files));
    const manifest = JSON.parse(files.written.get(exportPathFor('a27'))!);
    expect(manifest.format).toBe('drama-audio-edl/v3');
    expect(manifest.source.videoRef).toBe('video/ep3.mp4');
    expect(manifest.segments[0]).toMatchObject({ audioRef: 'voice/take2.mp3', videoStartMs: 0, videoEndMs: 4_200 });
    expect(manifest.segments[0].alignShiftMs).toBe(0); // 4200 间隔含停顿 = 4200
  });
});

describe('card.drama.audio.export', () => {
  it('写 EDL 清单到文件口并记录路径与摘要', async () => {
    const { node, data } = await attachNode('a13', 10_000, 'voice/take1.mp3');
    const files = makeFiles();
    const patch = await ops.export(nodeOf('a13', data as unknown as Record<string, unknown>), {}, ctxOf(files));
    const path = exportPathFor('a13');
    expect(path).toBe('card-assets/drama-audio/a13.edl.json');
    expect(files.written.get(path)).toBeDefined();
    expect(dataOf(patch).exportedPath).toBe(path);

    const manifest = JSON.parse(files.written.get(path)!);
    expect(manifest.format).toBe('drama-audio-edl/v3');
    expect(manifest.nodeId).toBe('a13');
    expect(manifest.source.audioRef).toBe('voice/take1.mp3');
    expect(manifest.segments[0].id).toBe('seg-0');
    expect(manifest.estimatedDurationMs).toBe(10_000);
  });
  it('同输入重复导出产生相同字节与摘要（handler 确定性）', async () => {
    const { node, data } = await attachNode('a14');
    const files = makeFiles();
    await ops.export(nodeOf('a14', data as unknown as Record<string, unknown>), {}, ctxOf(files));
    const first = files.written.get(exportPathFor('a14'));
    await ops.export(nodeOf('a14', data as unknown as Record<string, unknown>), {}, ctxOf(files));
    expect(files.written.get(exportPathFor('a14'))).toBe(first);
    const { digest } = renderExportManifest('a14', data);
    expect(dataOf(await ops.export(nodeOf('a14', data as unknown as Record<string, unknown>), {}, ctxOf(files))).exportedDigest).toBe(digest);
  });
});

describe('v3 生成链路：analyze / compose', () => {
  const ENV_KEYS = ['DRAMA_AUDIO_PROVIDER', 'DENSE_CAPTION_API_URL', 'DENSE_CAPTION_API_KEY', 'DUBBING_API_URL', 'DUBBING_API_KEY'] as const;
  let saved = new Map<string, string | undefined>();

  beforeEach(() => {
    saved = new Map(ENV_KEYS.map(key => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.DRAMA_AUDIO_PROVIDER = 'mock';
  });
  afterEach(() => { for (const [key, value] of saved) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });

  it('analyze 未绑视频源时明确报错', async () => {
    const { node } = await attachNode('a30', 10_000);
    await expect(ops.analyze(node, {}, ctxOf(makeFiles()))).rejects.toThrow('尚未绑定视频源');
  });

  it('analyze（mock）产出 captions 并记录来源', async () => {
    const node = nodeOf('a31');
    const patch = await ops.attach(node, { audioRef: 'voice/dub.mp3', durationMs: 10_000, videoRef: 'video/ep.mp4', videoDurationMs: 12_000 }, ctxOf(makeFiles()));
    const attached = nodeOf('a31', patch!.data as Record<string, unknown>);
    const result = await ops.analyze(attached, {}, ctxOf(makeFiles()));
    const data = dataOf(result);
    expect(data.captionProvider).toBe('mock');
    expect(data.captions).toHaveLength(4);
    expect(data.captions[0]).toMatchObject({ id: 'cap-0', startMs: 0, endMs: 3_000 });
  });

  it('analyze 未配置 provider 时动作失败（不假成功）', async () => {
    delete process.env.DRAMA_AUDIO_PROVIDER;
    const node = nodeOf('a32');
    const patch = await ops.attach(node, { audioRef: 'voice/dub.mp3', durationMs: 10_000, videoRef: 'video/ep.mp4', videoDurationMs: 12_000 }, ctxOf(makeFiles()));
    await expect(ops.analyze(nodeOf('a32', patch!.data as Record<string, unknown>), {}, ctxOf(makeFiles()))).rejects.toThrow('未配置');
  });

  it('compose（mock）产出配音文档并可进入导出清单', async () => {
    const node = nodeOf('a33');
    const patch = await ops.attach(node, { audioRef: 'voice/dub.mp3', durationMs: 10_000, videoRef: 'video/ep.mp4', videoDurationMs: 12_000 }, ctxOf(makeFiles()));
    let current = nodeOf('a33', patch!.data as Record<string, unknown>);
    current = nodeOf('a33', (await ops.analyze(current, {}, ctxOf(makeFiles())))!.data as Record<string, unknown>);
    const composed = await ops.compose(current, { script: '第一集开场' }, ctxOf(makeFiles()));
    const data = dataOf(composed);
    expect(data.dubbingProvider).toBe('mock');
    expect(data.dubbingDoc).toContain('第一集开场');

    const files = makeFiles();
    await ops.export(nodeOf('a33', composed!.data as Record<string, unknown>), {}, ctxOf(files));
    const manifest = JSON.parse(files.written.get(exportPathFor('a33'))!);
    expect(manifest.generation).toMatchObject({ captionProvider: 'mock', captionCount: 4, dubbingProvider: 'mock' });
    expect(manifest.generation.dubbingDoc).toContain('第一集开场');
  });
});

describe('handler 确定性（幂等重放安全）', () => {
  it.each([['gap', { segmentId: 'seg-0', gapMs: 250 }], ['gain', { gain: 1.2 }], ['trim', { startMs: 100 }]] as const)('%s 同输入两次输出一致', async (verb, params) => {
    const { node, data } = await attachNode('a15', 10_000);
    const payload = { ...data } as unknown as Record<string, unknown>;
    const first = await (ops[verb] as typeof ops.gap)(nodeOf('a15', payload), params, ctxOf(makeFiles()));
    const second = await (ops[verb] as typeof ops.gap)(nodeOf('a15', payload), params, ctxOf(makeFiles()));
    expect(second).toEqual(first);
  });
});
