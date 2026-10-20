import { afterEach, expect, it, vi } from 'vitest';
import { awaitCanvasGenerationBinding, flushCanvasForProject, registerCanvasPersistence } from '../src/platform/canvas-persistence';
import { readCanvasSelection, registerCanvasObjects, type CanvasObjectReference } from '../src/platform/object-bridge';
import { setCanvasHostContext } from '../src/platform/api-base';

const disposers: (() => void)[] = [];
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); setCanvasHostContext(null); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture(flush = vi.fn(async (_keys?: readonly string[]) => {})) {
  let requestId = 'request', status = 'running', version = 1;
  setCanvasHostContext({ projectId: 'project' });
  const dispose = registerCanvasPersistence('project', {
    read: () => ({ workbenchBasicNodes: [{ id: 'node', generation: { requestId, status } }] }),
    mutationVersion: () => version, flush,
  });
  disposers.push(dispose);
  return { flush, dispose, change(next = 'request', state = 'running') { requestId = next; status = state; version++; } };
}

it('rejects unavailable persistence rather than claiming a canvas was saved', async () => {
  setCanvasHostContext({ projectId: 'project' });
  await expect(flushCanvasForProject('project')).rejects.toThrow(/unavailable/);
  await expect(awaitCanvasGenerationBinding('project', 'node', 'request')).rejects.toThrow(/unavailable/);
});
it('propagates the actual canonical save error without sending or inventing a revision', async () => {
  const error = new Error('revision conflict');
  fixture(vi.fn(async () => { throw error; }));
  await expect(awaitCanvasGenerationBinding('project', 'node', 'request')).rejects.toBe(error);
  await expect(flushCanvasForProject('project')).rejects.toBe(error);
});
it.each(['failed', 'canceled', 'succeeded'])('rejects a non-running %s binding before flushing', async status => {
  const f = fixture(); f.change('request', status);
  await expect(awaitCanvasGenerationBinding('project', 'node', 'request')).rejects.toThrow(/stale|cancelled/);
  expect(f.flush).not.toHaveBeenCalled();
});
it('rejects a changed generation after its in-flight save completes', async () => {
  const save = deferred(); const f = fixture(vi.fn(() => save.promise));
  const pending = awaitCanvasGenerationBinding('project', 'node', 'request');
  const rejected = expect(pending).rejects.toThrow(/stale/);
  f.change('new-request'); save.resolve(); await rejected;
});
it('includes a late local mutation before returning a successful flush', async () => {
  const first = deferred(), second = deferred();
  const flush = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const f = fixture(flush); let finished = false;
  const pending = flushCanvasForProject('project').then(() => { finished = true; });
  f.change(); first.resolve(); await first.promise; await Promise.resolve(); await Promise.resolve();
  expect(flush).toHaveBeenCalledTimes(2); expect(finished).toBe(false);
  second.resolve(); await pending; expect(finished).toBe(true);
});
it('rejects destruction promptly even when a transport ignores cancellation', async () => {
  const save = deferred(); const f = fixture(vi.fn(() => save.promise));
  const pending = flushCanvasForProject('project');
  const rejected = expect(pending).rejects.toThrow(/unavailable/);
  f.dispose(); await rejected; save.resolve();
});
it('rejects a project switch after a delayed save instead of continuing in another project', async () => {
  const save = deferred(); fixture(vi.fn(() => save.promise));
  const pending = awaitCanvasGenerationBinding('project', 'node', 'request');
  const rejected = expect(pending).rejects.toThrow(/project changed/);
  setCanvasHostContext({ projectId: 'other' }); save.resolve(); await rejected;
});
it('rejects wrong project and wrong request before a save', async () => {
  const f = fixture();
  await expect(awaitCanvasGenerationBinding('project', 'node', 'other')).rejects.toThrow(/stale/);
  setCanvasHostContext({ projectId: 'other' });
  await expect(flushCanvasForProject('project')).rejects.toThrow(/project changed/);
  expect(f.flush).not.toHaveBeenCalled();
});
it('reads current Flow API selection references without including unsupported or foreign nodes', () => {
  setCanvasHostContext({ projectId: 'project' });
  let selected = ['text', 'image', 'foreign', 'text'];
  const reference: CanvasObjectReference = { projectId: 'project', nodeId: 'text', kind: 'text', label: 'Text', text: 'content', intent: 'modify' };
  const dispose = registerCanvasObjects('project', {
    selectedNodeIds: () => selected,
    read: id => id === 'image' ? null : id === 'foreign' ? { ...reference, projectId: 'other' } : { ...reference, nodeId: id },
    focus: () => true, prepare: async () => {}, fail: () => {},
  });
  disposers.push(dispose);
  expect(readCanvasSelection('project')).toEqual([{ ...reference, intent: 'reference' }]);
  selected = []; expect(readCanvasSelection('project')).toEqual([]);
  selected = ['text']; setCanvasHostContext({ projectId: 'other' });
  expect(readCanvasSelection('project')).toEqual([]);
  setCanvasHostContext({ projectId: 'project' }); dispose(); expect(readCanvasSelection('project')).toEqual([]);
});
