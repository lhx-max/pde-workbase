import { afterEach, describe, expect, it, vi } from 'vitest';
import { demoMediaUrl, demoProjectOf, transferRewriteToEditor, synthesizeDemoLines } from '../src/demo-adapter';

describe('本地 demo 资源边界', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('只保留 data 的宿主节点仍可识别 demo 工程', () => {
    vi.stubGlobal('location', { hostname: '127.0.0.1' });
    expect(demoProjectOf({ data: { demoProfile: 'local-test', demoProjectId: 'demo' } })).toBe('demo');
    vi.stubGlobal('location', { hostname: 'public.example' });
    expect(demoProjectOf({ data: { demoProfile: 'local-test', demoProjectId: 'demo' } })).toBeNull();
  });
  it('编码工程路径，不接受逃逸路径', () => {
    expect(demoMediaUrl('demo', 'inputs/原片.mp4')).toBe('/api/projects/demo/raw/inputs/%E5%8E%9F%E7%89%87.mp4');
    for (const path of ['/tmp/video.mp4', '../video.mp4', 'inputs/../video.mp4', 'inputs//video.mp4']) expect(() => demoMediaUrl('demo', path)).toThrow();
  });
  it('确认交付只修改目标编辑卡并保留原稿', async () => {
    const lines = [{ id: 'line-1', text: '改写台词', videoStartMs: 1000, videoEndMs: 5000 }];
    const nodes = [{ id: 'source', data: { stage: 'rewrite', downstreamNodeId: 'target', rewriteLines: lines, rewriteDoc: '改写台词', script: '原稿', videoRef: 'v.mp4', videoDurationMs: 6000, rewriteProvider: 'wanqing:model' } }, { id: 'target', data: { stage: 'edit', segments: [] } }];
    const mocked = vi.fn().mockResolvedValueOnce(Response.json({ storage: { canvas: 'explicit-local-runtime' } })).mockResolvedValueOnce(Response.json({ data: { revision: 5, state: { workbenchBasicNodes: nodes } } })).mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal('fetch', mocked);
    await transferRewriteToEditor('demo', 'source');
    const body = JSON.parse(mocked.mock.calls[2]![1].body);
    expect(body.expectedRevision).toBe(5);
    expect(body.changes.workbenchBasicNodes[0].data.script).toBe('原稿');
    expect(body.changes.workbenchBasicNodes[1].data).toMatchObject({ script: '改写台词', rewriteLines: lines, sourceNodeId: 'source', sourceRevision: 5, segments: [] });
  });
  it('输入区间非法时不会调用 TTS', async () => {
    const mocked = vi.fn().mockResolvedValueOnce(Response.json({ storage: { canvas: 'explicit-local-runtime' } })).mockResolvedValueOnce(Response.json({ data: { revision: 5, state: { workbenchBasicNodes: [{ id: 'edit', data: { stage: 'edit', videoDurationMs: 5000, rewriteLines: [{ id: 'line-1', text: '台词', videoStartMs: 0, videoEndMs: 6000 }] } }] } } }));
    vi.stubGlobal('fetch', mocked);
    await expect(synthesizeDemoLines('demo', 'edit', new AbortController().signal, () => {})).rejects.toThrow('不合法');
    expect(mocked).toHaveBeenCalledTimes(2);
  });
  it('普通卡片不启用 demo API', () => {
    expect(demoProjectOf({ id: 'card', demoProjectId: 'demo' })).toBeNull();
    expect(demoProjectOf({ demoProfile: 'local-test', demoProjectId: '../demo' })).toBeNull();
  });
});
