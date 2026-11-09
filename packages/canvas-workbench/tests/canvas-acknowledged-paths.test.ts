import { describe, expect, it } from 'vitest';
import { CanvasAcknowledgedPaths } from '../src/platform/canvas-acknowledged-paths';
const node = (id: string, path: string, text = 'body') => ({ id, kind: 'text', projectFilePath: path, text, x: 1 });

describe('acknowledged text document paths', () => {
  it('retains the duplicate receipt identity when an older optimistic view arrives', () => {
    const paths = new CanvasAcknowledgedPaths();
    const original = node('original', 'original.md');
    const optimistic = [original, node('copy', 'original.md')];
    const canonical = [original, node('copy', 'copy-op.md')];
    paths.acknowledge(optimistic, canonical);
    expect(paths.reconcile(canonical, optimistic)).toEqual(canonical);
    const edited = [original, { ...optimistic[1], text: 'new draft', x: 22 }];
    expect(paths.reconcile(canonical, edited)).toEqual([original, { ...canonical[1], text: 'new draft', x: 22 }]);
  });
  it('does not hijack other nodes, kinds, explicit new paths, or newer external state', () => {
    const paths = new CanvasAcknowledgedPaths();
    paths.acknowledge([node('copy', 'original.md')], [node('copy', 'copy.md')]);
    const newTarget = [node('copy', 'explicit-new.md')];
    expect(paths.reconcile([node('copy', 'copy.md')], newTarget)).toBe(newTarget);
    const newerState = [node('copy', 'newer-remote.md')], stale = [node('copy', 'original.md')];
    expect(paths.reconcile(newerState, stale)).toEqual(newerState);
    const unrelated = [node('other', 'original.md'), { ...node('copy', 'original.md'), kind: 'page' }];
    expect(paths.reconcile([node('copy', 'copy.md')], unrelated)).toBe(unrelated);
    expect(new CanvasAcknowledgedPaths().reconcile([node('copy', 'copy.md')], stale)).toBe(stale);
  });
  it('follows successive acknowledged path changes without changing new node identity', () => {
    const paths = new CanvasAcknowledgedPaths();
    paths.acknowledge([node('copy', 'original.md')], [node('copy', 'copy-v1.md')]);
    paths.acknowledge([node('copy', 'copy-v1.md')], [node('copy', 'copy-v2.md')]);
    expect(paths.reconcile([node('copy', 'copy-v2.md')], [node('copy', 'original.md')])).toEqual([node('copy', 'copy-v2.md')]);
    expect(paths.reconcile([node('copy', 'copy-v2.md')], [node('copy', 'copy-v1.md')])).toEqual([node('copy', 'copy-v2.md')]);
  });
});
