import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureLocalTts } from '../src/local-tts';
import { startTts } from '../src/ops';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('本地 TTS 启动边界', () => {
  it('非本地或未显式启用时不访问网络', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    vi.stubEnv('CANVAS_STORAGE_MODE', 'appwrite');
    vi.stubEnv('DRAMA_TTS_ENABLED', '1');
    await expect(ensureLocalTts()).rejects.toThrow('local-test');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('已就绪时复用服务，重复并发检查不拉起进程', async () => {
    vi.stubEnv('CANVAS_STORAGE_MODE', 'local-test');
    vi.stubEnv('DRAMA_TTS_ENABLED', '1');
    const fetcher = vi.fn().mockResolvedValue(Response.json({ named_endpoints: { '/generate': {} } }));
    vi.stubGlobal('fetch', fetcher);
    await Promise.all([ensureLocalTts(), ensureLocalTts()]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:8808/gradio_api/info');
  });

  it('服务不可用且路径未配置时明确失败', async () => {
    vi.stubEnv('CANVAS_STORAGE_MODE', 'local-test');
    vi.stubEnv('DRAMA_TTS_ENABLED', '1');
    vi.stubEnv('DRAMA_TTS_PYTHON', '');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('连接失败')));
    await expect(ensureLocalTts()).rejects.toThrow('DRAMA_TTS_PYTHON');
  });

  it('启动动作拒绝跨实例和客户端路径参数', async () => {
    const node = { id: 'edit', data: { demoProfile: 'local-test', demoProjectId: 'drama-demo-one' } };
    const ctx = { projectId: 'drama-demo-other', files: {} } as Parameters<typeof startTts>[2];
    await expect(startTts(node, {}, ctx)).rejects.toThrow('同实例');
    await expect(startTts(node, { command: 'unsafe' }, { ...ctx, projectId: 'drama-demo-one' })).rejects.toThrow('不接受');
  });
});
