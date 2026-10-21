// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { DocDocumentApi } from '@doc/surface';
import { AppTabSurface } from '../src/app-surfaces';
let pane: { api: DocDocumentApi; onDirtyChange: (dirty: boolean) => void; registerFlush: (flush: () => Promise<boolean>) => void };
vi.mock('@doc/surface', () => ({ DocumentEditorPane: (props: typeof pane) => { pane = props; return <div>Editor</div>; } }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const tab = { id: 'app:doc:d', appId: 'doc', target: 'd', label: '正文' };
const app = { appId: 'doc', name: '文档', endpoint: 'http://doc/api/apps/doc' };
const saved = () => new Response(JSON.stringify({ data: { result: { meta: { id: 'd' }, content: '正文', revision: 'r1', mirror: { status: 'unbound' } } } }), { status: 200 });

it('clears a saved tab dirty marker and unregisters lifecycle callbacks when closed', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => saved()));
  const dirty = vi.fn(), register = vi.fn();
  const view = render(<AppTabSurface tab={tab} app={app} onDirtyChange={dirty} registerFlush={register} />);
  await pane.api.read();
  pane.onDirtyChange(true);
  const flush = async () => true; pane.registerFlush(flush);
  expect(register).toHaveBeenLastCalledWith(flush);
  await act(async () => { await pane.api.write('正文'); });
  expect(dirty).toHaveBeenLastCalledWith(false);
  view.unmount();
  expect(register).toHaveBeenLastCalledWith(null);
  expect(dirty).toHaveBeenLastCalledWith(false);
});

it('does not mark newer unsaved typing clean when an earlier save finishes', async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(saved()).mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; })));
  const dirty = vi.fn();
  render(<AppTabSurface tab={tab} app={app} onDirtyChange={dirty} />);
  await pane.api.read();
  pane.onDirtyChange(true);
  const pending = pane.api.write('第一版');
  pane.onDirtyChange(true); // the editor has newer typing while first save is in flight
  await act(async () => { finish(saved()); await pending; });
  expect(dirty).toHaveBeenLastCalledWith(true);
});
