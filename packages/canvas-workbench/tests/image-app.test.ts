import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/platform/canvas-persistence', () => ({ flushCanvasForProject: vi.fn() }));
vi.mock('../src/platform/api-base', () => ({ platformFetchWithContext: vi.fn() }));
import { flushCanvasForProject } from '../src/platform/canvas-persistence';
import { platformFetchWithContext } from '../src/platform/api-base';
import { openCanvasImageEditor } from '../src/platform/image-app';

const target = { appId: 'image' as const, kind: 'image' as const, canvasInstanceId: 'canvas-a', nodeId: 'image-1', endpoint: 'http://127.0.0.1:19010/api/apps/image', filePath: 'images/source.png', revision: 7, name: 'Image' };
beforeEach(() => { vi.resetAllMocks(); vi.mocked(flushCanvasForProject).mockResolvedValue(); vi.mocked(platformFetchWithContext).mockResolvedValue(Response.json({ data: target })); });
it('flushes and resolves the same image before invoking the host mode', async () => {
  const open = vi.fn(async () => {});
  await openCanvasImageEditor({ projectId: 'canvas-a' }, 'image-1', open, () => true);
  expect(flushCanvasForProject).toHaveBeenCalledWith('canvas-a');
  expect(platformFetchWithContext).toHaveBeenCalledWith({ projectId: 'canvas-a' }, '/api/apps/canvas/instances/canvas-a/open-editor', expect.objectContaining({ body: JSON.stringify({ nodeId: 'image-1' }) }));
  expect(open).toHaveBeenCalledWith(target);
  expect(vi.mocked(flushCanvasForProject).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(platformFetchWithContext).mock.invocationCallOrder[0]!);
});
it('never pretends the unconfigured mode is open', async () => {
  await expect(openCanvasImageEditor({ projectId: 'canvas-a' }, 'image-1', undefined, () => true)).rejects.toThrow('尚未接入');
  expect(platformFetchWithContext).not.toHaveBeenCalled();
});
it('keeps failed saves from navigating', async () => {
  vi.mocked(flushCanvasForProject).mockRejectedValue(new Error('save conflict'));
  const open = vi.fn(async () => {});
  await expect(openCanvasImageEditor({ projectId: 'canvas-a' }, 'image-1', open, () => true)).rejects.toThrow('save conflict');
  expect(open).not.toHaveBeenCalled(); expect(platformFetchWithContext).not.toHaveBeenCalled();
});
it('rejects a different image or a project switch while resolving', async () => {
  const open = vi.fn(async () => {});
  vi.mocked(platformFetchWithContext).mockResolvedValue(Response.json({ data: { ...target, nodeId: 'other' } }));
  await expect(openCanvasImageEditor({ projectId: 'canvas-a' }, 'image-1', open, () => true)).rejects.toThrow('未打开其他图片');
  vi.mocked(platformFetchWithContext).mockResolvedValue(Response.json({ data: target }));
  let calls = 0;
  await expect(openCanvasImageEditor({ projectId: 'canvas-a' }, 'image-1', open, () => ++calls === 1)).rejects.toThrow('画布已切换');
  expect(open).not.toHaveBeenCalled();
});
it('propagates registration and permission failures without opening', async () => {
  vi.mocked(platformFetchWithContext).mockResolvedValue(Response.json({ error: { message: '图片 App 尚未注册' } }, { status: 404 }));
  const open = vi.fn(async () => {});
  await expect(openCanvasImageEditor({ projectId: 'canvas-a' }, 'image-1', open, () => true)).rejects.toThrow('尚未注册');
  expect(open).not.toHaveBeenCalled();
});
