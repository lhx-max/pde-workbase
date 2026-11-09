// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppTabSurface } from '../src/app-surfaces';
import { sketchPreviewChannel, sketchPreviewKey } from '../src/state/sketch-preview-channel';

const probe = vi.hoisted(() => ({ props: null as null | { api: { readSnapshot(): Promise<unknown>; write(content: string): Promise<unknown> }; onSceneChange(scene: unknown): void } }));
vi.mock('../src/app-surfaces/browser-transport', () => ({ browserAppTransport: {} }));
vi.mock('@doc/surface', () => ({ DocumentEditorPane: () => null }));
vi.mock('@doc/surface/styles.css', () => ({}));
vi.mock('@sketch/surface', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
  serializeExcalidrawSketchScene: (scene: unknown) => JSON.stringify(scene),
  SketchEditorPane: (props: NonNullable<typeof probe.props>) => {
    probe.props = props;
    React.useEffect(() => { void props.api.readSnapshot(); }, [props.api]);
    return <div>sketch engine</div>;
  },
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); probe.props = null; });

it('retains the editor API across parent callbacks and never replaces a newer live scene with an older save acknowledgement', async () => {
  let acknowledge!: (value: Response) => void;
  const fetcher = vi.fn(async (url: string) => url.endsWith('sketch.write')
    ? new Promise<Response>(resolve => { acknowledge = resolve; })
    : Response.json({ data: { result: { content: '{}', revision: 'v1' } } }));
  vi.stubGlobal('fetch', fetcher);
  const tab = { id: 'app:sketch:one', appId: 'sketch', target: 'one', label: 'Sketch', mirrorPath: 'one.sketch.json' };
  const app = { appId: 'sketch', name: 'Sketch', endpoint: '/api/apps/sketch' };
  const props = { tab, app, canvasId: 'preview-race', previewScope: 'actor-a' };
  const mounted = render(<AppTabSurface {...props} onMirrorSaved={() => undefined} />);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const originalApi = probe.props!.api;
  mounted.rerender(<AppTabSurface {...props} onMirrorSaved={() => undefined} />);
  expect(probe.props!.api).toBe(originalApi);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const oldSave = originalApi.write('{"old":true}');
  const key = sketchPreviewKey('actor-a', 'preview-race', tab.mirrorPath);
  await act(async () => probe.props!.onSceneChange({ newer: true }));
  await act(async () => { acknowledge(Response.json({ data: { result: { meta: { id: 'one', path: tab.mirrorPath }, revision: 'v2' } } })); await oldSave; });
  expect(sketchPreviewChannel.read(key)).toBe('{"newer":true}');
  sketchPreviewChannel.remove(key);
});
