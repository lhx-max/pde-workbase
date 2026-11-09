// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openBoundDoc } from '../src/app-surfaces/doc-protocol';
import { httpDocApi } from '../src/app-surfaces';

const response = (result: unknown, status = 200) => new Response(JSON.stringify({ data: { result } }), { status, headers: { 'content-type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('document truth and mirror status', () => {
  it('sends the read baseline on legacy writes and refuses writes without a baseline', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ content: 'base', revision: 'r1' }))
      .mockResolvedValueOnce(response({ content: 'canonical', revision: 'r2', meta: { id: 'd' } }));
    vi.stubGlobal('fetch', fetcher);
    const api = httpDocApi('http://doc/api/apps/doc', 'd');
    await expect(api.write('blind')).rejects.toThrow('先读取');
    expect(fetcher).not.toHaveBeenCalled();
    expect(await api.read()).toBe('base');
    await api.write('draft');
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({ input: { content: 'draft', baseContent: 'base', expectedRevision: 'r1' } });
  });
  it('preserves structured conflict details for explicit recovery', async () => {
    const details = { currentContent: 'remote', currentRevision: 'r2' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'DOC_CONFLICT', message: 'conflict', details } }), { status: 409 })));
    await expect(httpDocApi('http://doc/api/apps/doc', 'd').writeSnapshot!('draft', { baseContent: 'base', expectedRevision: 'r1' })).rejects.toMatchObject({ status: 409, code: 'DOC_CONFLICT', details });
  });
  it('refuses snapshot reads lacking a revision instead of enabling blind saves', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ content: 'text' })));
    await expect(httpDocApi('http://doc/api/apps/doc', 'd').readSnapshot!()).rejects.toThrow('未返回版本');
  });
  it('opens App truth without overwriting it with a stale canvas mirror', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ instanceId: 'doc-1' }))
      .mockResolvedValueOnce(response({ content: '最新文档', meta: { name: '正文' } }));
    vi.stubGlobal('fetch', fetcher);
    const result = await openBoundDoc('http://doc/api/apps/doc', { nodeId: 'n', content: '旧副本', mirrorCanvasId: 'c' }, { 'x-team-id': 'team-a' });
    expect(result.content).toBe('最新文档');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      'http://doc/api/apps/doc/actions/doc.create', 'http://doc/api/apps/doc/instances/doc-1/actions/doc.read',
    ]);
    expect(fetcher.mock.calls[0]![1].headers['x-team-id']).toBe('team-a');
  });
  it('does not convert a failed doc read into empty content or a write', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response({ instanceId: 'doc-1' })).mockResolvedValueOnce(response({}, 403));
    vi.stubGlobal('fetch', fetcher);
    await expect(openBoundDoc('http://doc/api/apps/doc', {}, {})).rejects.toThrow('403');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('rejects a malformed editor read rather than treating it as an empty document', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({})));
    await expect(httpDocApi('http://doc/api/apps/doc', 'doc-1').read()).rejects.toThrow('未返回正文');
  });
  it('reports saved document plus mirror conflict without pretending the card is updated', async () => {
    const meta = { id: 'doc-1', name: '正文', path: 'doc-1.md', size: 3, updatedAt: '' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ meta, content: '正文', revision: 'r2', mirror: { status: 'conflict' } })));
    const onSaved = vi.fn(), warning = vi.fn();
    const api = httpDocApi('http://doc/api/apps/doc', 'doc-1', { canvasId: 'c', path: 'old.md', onSaved }, warning);
    expect((await api.writeSnapshot!('正文', { baseContent: 'base', expectedRevision: 'r1' })).meta).toEqual(meta);
    expect(onSaved).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('文档已保存'));
  });
  it('refreshes only the confirmed current mirror path after a successful save', async () => {
    const meta = { id: 'doc-1', name: '正文', path: 'doc-1.md', size: 3, updatedAt: '' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ meta, content: '正文 + 合并', revision: 'r2', mirror: { status: 'synced', path: 'current.md' } })));
    const onSaved = vi.fn(), warning = vi.fn();
    await httpDocApi('http://doc/api/apps/doc', 'doc-1', { canvasId: 'c', path: 'old.md', onSaved }, warning).writeSnapshot!('正文', { baseContent: 'base', expectedRevision: 'r1' });
    expect(onSaved).toHaveBeenCalledWith('current.md', '正文 + 合并');
    expect(warning).toHaveBeenCalledWith('');
  });
});
