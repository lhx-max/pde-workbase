// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCanvasTextDocumentChange } from '../src/workbench/useCanvasTextDocumentChange';
import { applyCanvasTextDocumentChange } from '../src/workbench/model/canvas-text-files';
import type { TextDocumentChange } from '../src/platform/artifact-bridge';
import type { CanvasBasicNode } from '../src/workbench/BasicCanvasNode';

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const event = (revision = 1, content = 'saved', projectId = 'a'): TextDocumentChange => ({ projectId, path: 'text.md', content, revision });
function Host({ projectId, change, apply }: { projectId: string; change?: TextDocumentChange | null; apply: (change: TextDocumentChange) => void }) {
  useCanvasTextDocumentChange(projectId, change, apply);
  return null;
}
const render = (change: TextDocumentChange | null, apply: (change: TextDocumentChange) => void, projectId = 'a', strict = false) => {
  act(() => root.render(strict ? createElement(StrictMode, null, createElement(Host, { projectId, change, apply })) : createElement(Host, { projectId, change, apply })));
};

it('does not replay an old notification when the setter identity changes after a newer canonical save', () => {
  let nodes = [{ id: 'n', kind: 'text', x: 0, y: 0, text: 'initial', projectFilePath: 'text.md' }] as CanvasBasicNode[];
  const oldEvent = event(1, 'old embedded draft');
  const firstSetter = vi.fn((change: TextDocumentChange) => { nodes = applyCanvasTextDocumentChange(nodes, change); });
  render(oldEvent, firstSetter);
  expect(nodes[0]!.text).toBe('old embedded draft');
  // The server/SSE has now delivered the user's explicitly confirmed content.
  nodes = [{ ...nodes[0]!, text: 'confirmed canonical content' }];
  const nextSetter = vi.fn((change: TextDocumentChange) => { nodes = applyCanvasTextDocumentChange(nodes, change); });
  render(oldEvent, nextSetter);
  expect(nextSetter).not.toHaveBeenCalled();
  expect(nodes[0]!.text).toBe('confirmed canonical content');
});

it('applies a new notification once using the newest setter and ignores cloned or older notifications', () => {
  const first = vi.fn(), latest = vi.fn();
  const one = event();
  render(one, first);
  render(one, latest);
  const two = event(2, 'new save');
  render(two, latest);
  render({ ...two }, latest);
  render({ ...one }, latest);
  expect(first).toHaveBeenCalledTimes(1);
  expect(latest).toHaveBeenCalledExactlyOnceWith(two);
});

it('accepts distinct new saves in one millisecond but never replays either identical notification', () => {
  const apply = vi.fn();
  const one = event(10, 'first'), two = event(10, 'second');
  render(one, apply);
  render(two, apply);
  render({ ...one }, apply);
  render({ ...two }, apply);
  expect(apply).toHaveBeenCalledTimes(2);
});

it('never applies an old project notification to the same path in a different project, including remounts', () => {
  const applyA = vi.fn(), applyB = vi.fn();
  const old = event(1, 'project A', 'a');
  render(old, applyA, 'a');
  render(old, applyB, 'b');
  render({ ...old }, applyB, 'b');
  act(() => root.render(null));
  render({ ...old }, applyB, 'b');
  expect(applyB).not.toHaveBeenCalled();
  const next = event(1, 'project B', 'b');
  render(next, applyB, 'b');
  expect(applyB).toHaveBeenCalledExactlyOnceWith(next);
});

it('does not replay a retained event after project-keyed remount or StrictMode effects', () => {
  const apply = vi.fn();
  const one = event();
  render(one, apply, 'a', true);
  expect(apply).toHaveBeenCalledTimes(1);
  act(() => root.render(null));
  render(one, apply, 'a', true);
  expect(apply).toHaveBeenCalledTimes(1);
});

it('keeps legacy unscoped notifications within the first project and consumes scoped new events after switching', () => {
  const apply = vi.fn();
  const legacy = { path: 'text.md', content: 'legacy', revision: 1 };
  render(legacy, apply, 'a');
  render({ ...legacy, revision: 2 }, apply, 'b');
  render({ ...legacy, revision: 3 }, apply, 'a');
  expect(apply).toHaveBeenCalledTimes(1);
  const next = event(4, 'new scoped');
  render(next, apply, 'a');
  expect(apply).toHaveBeenCalledTimes(2);
});
