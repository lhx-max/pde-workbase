// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasDocumentSyncNotice, type CanvasDocumentSyncEntry } from '../src/app-surfaces/CanvasDocumentSyncNotice';

vi.mock('../src/app-surfaces/index', () => ({ tenantHeaders: () => ({ 'x-team-id': 'team-a', 'x-user-id': 'user-a' }) }));
const entry = (patch: Partial<CanvasDocumentSyncEntry> = {}): CanvasDocumentSyncEntry => ({ nodeId: 'n', title: '正文', status: 'conflict', content: 'canvas draft', remoteContent: 'saved document', documentRevision: 'r1', ...patch });
const response = (entries: CanvasDocumentSyncEntry[]) => new Response(JSON.stringify({ data: { entries } }), { status: 200 });
const settle = async () => { await act(async () => { await Promise.resolve(); }); };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('polls every three seconds and on focus/visibility with tenant headers', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockImplementation(async () => response([entry({ status: 'pending' })]));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<CanvasDocumentSyncNotice canvasId="canvas/a" />);
  await settle();
  expect(fetcher.mock.calls[0]![0]).toBe('/api/apps/canvas/instances/canvas%2Fa/document-sync');
  expect(fetcher.mock.calls[0]![1].headers).toMatchObject({ 'x-team-id': 'team-a', 'x-user-id': 'user-a' });
  expect(screen.getByText('画布草稿待同步（不代表文档已保存）')).toBeTruthy();
  expect(screen.queryByText('采用画布草稿')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(fetcher).toHaveBeenCalledTimes(4);
  view.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it('shows both versions and only resolves after confirmation with exact observed versions', async () => {
  const fetcher = vi.fn().mockImplementation(async () => response([entry()]));
  vi.stubGlobal('fetch', fetcher);
  const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  vi.stubGlobal('confirm', confirm);
  render(<CanvasDocumentSyncNotice canvasId="c" />);
  await settle();
  expect(screen.getByText('canvas draft')).toBeTruthy();
  expect(screen.getByText('saved document')).toBeTruthy();
  fireEvent.click(screen.getByText('采用文档已保存版本'));
  await settle();
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('采用文档已保存版本'));
  await settle();
  const mutation = fetcher.mock.calls.find(call => call[1]?.method === 'POST')!;
  expect(mutation[0]).toBe('/api/apps/canvas/instances/c/document-sync/resolve');
  expect(JSON.parse(mutation[1].body)).toEqual({ nodeId: 'n', choice: 'document', expectedCanvasContent: 'canvas draft', expectedDocumentRevision: 'r1' });
  expect(mutation[1].headers['x-team-id']).toBe('team-a');
});

it('preserves conflict and requires fresh confirmation after a stale 409 instead of replaying the choice', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response([entry()]))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'stale' } }), { status: 409 }))
    .mockImplementation(async () => response([entry({ remoteContent: 'new saved document', documentRevision: 'r2' })]));
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
  render(<CanvasDocumentSyncNotice canvasId="c" />);
  await settle();
  fireEvent.click(screen.getByText('采用画布草稿'));
  await settle();
  expect(screen.getByRole('alert').textContent).toContain('未应用您的选择');
  expect(screen.getByText('canvas draft')).toBeTruthy();
  expect(screen.getByText('new saved document')).toBeTruthy();
  expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
});

it('does not offer resolution without both remote content and document revision, but accepts empty remote content', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response([entry({ remoteContent: undefined })]))
    .mockResolvedValueOnce(response([entry({ documentRevision: undefined })]))
    .mockResolvedValueOnce(response([entry({ remoteContent: '' })]));
  vi.stubGlobal('fetch', fetcher);
  render(<CanvasDocumentSyncNotice canvasId="c" />);
  await settle();
  expect(screen.queryByText('采用画布草稿')).toBeNull();
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(screen.queryByText('采用画布草稿')).toBeNull();
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(screen.getByText('采用画布草稿')).toBeTruthy();
  expect(screen.getByText('（空正文）')).toBeTruthy();
});

it('keeps the last known draft visible on polling failure and keeps unconfigured errors compact', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response([entry()])).mockRejectedValueOnce(new Error('offline'));
  vi.stubGlobal('fetch', fetcher);
  const view = render(<CanvasDocumentSyncNotice canvasId="c" />);
  await settle();
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(screen.getByRole('alert').textContent).toContain('offline');
  expect(screen.getByText('canvas draft')).toBeTruthy();
  view.unmount();
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'APP_NOT_INSTALLED' } }), { status: 404 }));
  render(<CanvasDocumentSyncNotice canvasId="other" />);
  await settle();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('尚未配置');
});

it('does not fetch when disabled and confirms retry without an implicit force choice', async () => {
  const fetcher = vi.fn().mockImplementation(async () => response([entry({ status: 'blocked', error: 'connection unavailable' })]));
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
  const view = render(<CanvasDocumentSyncNotice canvasId="c" enabled={false} />);
  await settle();
  expect(fetcher).not.toHaveBeenCalled();
  view.rerender(<CanvasDocumentSyncNotice canvasId="c" />);
  await settle();
  fireEvent.click(screen.getByText('重试同步'));
  await settle();
  const mutation = fetcher.mock.calls.find(call => call[1]?.method === 'POST')!;
  expect(mutation[0]).toBe('/api/apps/canvas/instances/c/document-sync/retry');
  expect(JSON.parse(mutation[1].body)).toEqual({ nodeId: 'n' });
});
