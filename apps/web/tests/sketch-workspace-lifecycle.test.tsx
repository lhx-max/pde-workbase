// @vitest-environment jsdom
import { createElement, type ComponentProps } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectFile } from '@bezier/contracts';
import type { SketchEditor } from '../src/components/SketchEditor';
import { SketchWorkspaceTab } from '../src/components/workspace/SketchWorkspaceTab';
import { serializeExcalidrawSketchScene, type ExcalidrawSketchScene } from '../src/components/sketch-model';

type EditorProps = ComponentProps<typeof SketchEditor>;
const mocks = vi.hoisted(() => ({
  read: vi.fn(), write: vi.fn(), export: vi.fn(), editor: vi.fn<(props: EditorProps) => void>(), t: (key: string) => key,
}));
vi.mock('../src/providers/registry', () => ({ fetchProjectFileText: mocks.read, writeProjectTextFile: mocks.write, writeProjectBase64File: mocks.export }));
vi.mock('../src/i18n', () => ({ useT: () => mocks.t }));
vi.mock('../src/components/SketchEditor', () => ({ SketchEditor: (props: EditorProps) => { mocks.editor(props); return null; } }));
const file: ProjectFile = { name: 'sources/sketches/drawing.excalidraw', path: 'sources/sketches/drawing.excalidraw', size: 100, mtime: 1, kind: 'sketch', mime: 'application/json' };
const drawing = (id: string, appState: Record<string, unknown> = {}): ExcalidrawSketchScene => ({ elements: [{ id, type: 'rectangle', x: 1, y: 2 }], files: {}, appState: { viewBackgroundColor: '#ffffff', ...appState } });
const content = (scene: ExcalidrawSketchScene) => serializeExcalidrawSketchScene(scene, file.name);
const editor = () => mocks.editor.mock.calls.at(-1)![0];
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
async function mount(initial = file, projectId = 'project') {
  let flush: (() => Promise<boolean>) | null = null;
  const props = { projectId, file: initial, onRefreshFiles: vi.fn(async () => {}), onOpenFile: vi.fn(), onRename: vi.fn(async (_from: string, to: string) => ({ ...file, name: to })), onDirtyChange: vi.fn(), registerFlush: (next: typeof flush) => { flush = next; } };
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(createElement(SketchWorkspaceTab, props)); });
  return { props, view, flush: () => flush!(), async refresh(next: ProjectFile, project = projectId) { await act(async () => { view.rerender(createElement(SketchWorkspaceTab, { ...props, projectId: project, file: next })); }); } };
}
beforeEach(() => {
  vi.useFakeTimers(); mocks.read.mockReset().mockResolvedValue(content(drawing('original')));
  // A successful provider write changes the bytes subsequently returned by reads;
  // the list metadata may still lag behind that durable write.
  mocks.write.mockReset().mockImplementation(async (_project: string, _name: string, source: string) => {
    mocks.read.mockResolvedValue(source); return { ...file, mtime: 2 };
  });
  mocks.export.mockReset(); mocks.editor.mockClear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('sketch disk hydration integrity', () => {
  it('reloads changed mtime/size and changes engine hydration identity for external drawings', async () => {
    const h = await mount(); const before = editor().sceneRevision;
    mocks.read.mockResolvedValueOnce(content(drawing('agent-edit')));
    await h.refresh({ ...file, mtime: 2, size: 120 });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(editor().scene.elements).toEqual(drawing('agent-edit').elements);
    expect(editor().sceneRevision).not.toBe(before);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('preserves the scene object and undo identity on identical drawing metadata echoes', async () => {
    const h = await mount(); const before = editor();
    mocks.read.mockResolvedValueOnce(content(drawing('original', { scrollX: 200, selectedElementIds: { original: true } })));
    await h.refresh({ ...file, mtime: 2 });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(editor().scene).toBe(before.scene); expect(editor().sceneRevision).toBe(before.sceneRevision);
    expect(editor().dirty).toBe(false);
  });
  it('does not fetch an external reload over a dirty local drawing', async () => {
    const h = await mount();
    await act(async () => { editor().onSceneChange(drawing('local')); });
    await h.refresh({ ...file, mtime: 2 });
    expect(mocks.read).toHaveBeenCalledOnce(); expect(editor().scene.elements).toEqual(drawing('local').elements);
    expect(editor().dirty).toBe(true);
  });
  it('ignores a slow external read after the user changes the local scene', async () => {
    const h = await mount(); const pending = deferred<string>(); mocks.read.mockReturnValueOnce(pending.promise);
    await h.refresh({ ...file, mtime: 2 }); expect(mocks.read).toHaveBeenCalledTimes(2);
    await act(async () => { editor().onSceneChange(drawing('local')); pending.resolve(content(drawing('remote'))); });
    expect(editor().scene.elements).toEqual(drawing('local').elements); expect(editor().dirty).toBe(true);
  });
  it('protects scene revisions even for non-dirty editor updates during a read', async () => {
    const h = await mount(); const pending = deferred<string>(); mocks.read.mockReturnValueOnce(pending.promise);
    await h.refresh({ ...file, mtime: 2 });
    await act(async () => { editor().onSceneChange(drawing('view-snapshot'), { markDirty: false }); pending.resolve(content(drawing('stale'))); });
    expect(editor().scene.elements).toEqual(drawing('view-snapshot').elements);
    expect(editor().dirty).toBe(false); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('does not replace the drawing with an editable blank when an external reload fails', async () => {
    const h = await mount(); mocks.read.mockRejectedValueOnce(new Error('File read failed'));
    await h.refresh({ ...file, mtime: 2 });
    expect(h.view.queryByRole('alert')?.textContent).toContain('File read failed');
    await act(async () => { expect(await h.flush()).toBe(false); });
    expect(mocks.write).not.toHaveBeenCalled();
    mocks.read.mockResolvedValueOnce(content(drawing('recovered'))); await h.refresh({ ...file, mtime: 3 });
    expect(editor().scene.elements).toEqual(drawing('recovered').elements);
    expect(editor().saveError).toBe(false);
  });
  it('ignores superseded reads and project-switch responses', async () => {
    const h = await mount(); const old = deferred<string>(); mocks.read.mockReturnValueOnce(old.promise);
    await h.refresh({ ...file, mtime: 2 });
    mocks.read.mockResolvedValueOnce(content(drawing('new-project')));
    await h.refresh({ ...file, mtime: 3 }, 'other-project');
    await act(async () => { old.resolve(content(drawing('old-project'))); });
    expect(editor().scene.elements).toEqual(drawing('new-project').elements);
    expect(editor().sceneRevision).toContain('other-project');
  });
  it.each([null, '{broken', '{"type":"unknown"}'])('never creates a writable blank scene after invalid disk content %s', async source => {
    mocks.read.mockResolvedValueOnce(source); const h = await mount();
    expect(mocks.editor).not.toHaveBeenCalled(); expect(h.view.queryByRole('alert')).not.toBeNull();
    await act(async () => { expect(await h.flush()).toBe(false); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); }); expect(mocks.write).not.toHaveBeenCalled();
  });
});

describe('sketch autosave and flush integrity', () => {
  it('autosaves at the debounce boundary and preserves hydration identity across its own file echo', async () => {
    const h = await mount(); const before = editor().sceneRevision;
    await act(async () => { editor().onSceneChange(drawing('local')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(699); }); expect(mocks.write).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.write).toHaveBeenCalledOnce(); expect(JSON.parse(mocks.write.mock.calls[0]![2]).elements).toEqual(drawing('local').elements);
    mocks.read.mockResolvedValue(content(drawing('local'))); await h.refresh({ ...file, mtime: 2 });
    expect(editor().sceneRevision).toBe(before); expect(editor().dirty).toBe(false);
    expect(h.props.onDirtyChange).toHaveBeenLastCalledWith(false);
  });
  it('keeps local edits safe during an in-flight save and flushes the newest revision before resolving', async () => {
    const h = await mount(); const firstWrite = deferred<ProjectFile | null>(); mocks.write.mockReturnValueOnce(firstWrite.promise);
    await act(async () => { editor().onSceneChange(drawing('first')); });
    let flushing!: Promise<boolean>;
    await act(async () => { flushing = h.flush(); }); expect(mocks.write).toHaveBeenCalledOnce();
    await act(async () => { editor().onSceneChange(drawing('newer')); });
    await h.refresh({ ...file, mtime: 2 }); expect(mocks.read).toHaveBeenCalledOnce();
    await act(async () => { firstWrite.resolve({ ...file, mtime: 2 }); expect(await flushing).toBe(true); });
    expect(mocks.write).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mocks.write.mock.calls[1]![2]).elements).toEqual(drawing('newer').elements);
    expect(editor().dirty).toBe(false);
  });
  it('treats null writes as failures and retains dirty content for explicit retry', async () => {
    const h = await mount(); mocks.write.mockResolvedValueOnce(null);
    await act(async () => { editor().onSceneChange(drawing('unsaved')); });
    await act(async () => { expect(await h.flush()).toBe(false); });
    expect(editor().dirty).toBe(true); expect(editor().saveError).toBe(true);
    await act(async () => { expect(await h.flush()).toBe(true); });
    expect(editor().dirty).toBe(false); expect(mocks.write).toHaveBeenCalledTimes(2);
  });
  it('does not report a durable write as failed just because refreshing the file list failed', async () => {
    const h = await mount(); h.props.onRefreshFiles.mockRejectedValueOnce(new Error('Refresh offline')); vi.spyOn(console, 'warn').mockImplementation(() => {});
    await act(async () => { editor().onSceneChange(drawing('saved')); });
    await act(async () => { expect(await h.flush()).toBe(true); });
    expect(editor().dirty).toBe(false); expect(editor().saveError).toBe(false);
  });
  it('flushes the engine snapshot before rename and never renames after a failed write', async () => {
    const h = await mount(); mocks.write.mockRejectedValueOnce(new Error('Disk full'));
    await act(async () => { expect(await editor().onRename!('renamed', drawing('engine-snapshot'))).toBe(false); });
    expect(h.props.onRename).not.toHaveBeenCalled();
    await act(async () => { expect(await editor().onRename!('renamed', drawing('engine-snapshot'))).toBe(true); });
    expect(h.props.onRename).toHaveBeenCalledWith(file.name, 'sources/sketches/renamed.excalidraw');
    expect(mocks.write.mock.invocationCallOrder[1]).toBeLessThan(h.props.onRename.mock.invocationCallOrder[0]!);
  });
});
