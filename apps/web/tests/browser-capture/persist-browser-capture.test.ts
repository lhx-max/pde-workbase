import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BezierHostBrowserCapture } from '@bezier/host';

import { persistBrowserCapture } from '../../src/browser-capture/persist-browser-capture';

const selectionCapture: BezierHostBrowserCapture = {
  captureId: 'cap_synthetic',
  kind: 'selection',
  intent: 'save_project',
  source: { pageUrl: 'https://example.test/article', title: 'Example' },
  selection: { text: 'synthetic selection text' },
  capturedAt: '2026-09-15T00:00:00.000Z',
};

describe('persistBrowserCapture', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reads saved inspector metadata without an optional analysis adapter', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async url => {
      if (String(url).endsWith('/analysis')) return new Response(JSON.stringify({ error: 'Analysis not configured' }), { status: 503 });
      if (String(url).endsWith('/prompt')) return new Response(JSON.stringify({ status: 'idle', available: false }), { status: 200 });
      return new Response(JSON.stringify({ asset: { id: 'asset-a', name: 'Saved capture' } }), { status: 200 });
    }));
    const result = await persistBrowserCapture('p', { ...selectionCapture, assetOperation: { assetId: 'asset-a', action: 'read' } });
    expect(result.ok).toBe(true); expect(result.assetData?.asset.id).toBe('asset-a'); expect(result.assetData?.analysis).toBeUndefined();
  });

  it('writes the selection text and a matching source sidecar under collected/', async () => {
    const calls: Array<{ url: string; body: string }> = [];
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, init) => {
      calls.push({ url: String(url), body: String((init as RequestInit).body) });
      const name = calls.length === 1 ? 'collected/selection-a.md' : 'collected/selection-a.md.source.json';
      return new Response(JSON.stringify({ file: { name, path: name, size: 0, mtime: 0 } }), { status: 200 });
    }));

    const result = await persistBrowserCapture('project-1', selectionCapture);

    expect(result.ok).toBe(true);
    expect(result.files).toHaveLength(2);
    expect(result.files![0]).toMatch(/^inputs\/collected\/selection-.+\.md$/);
    expect(result.files![1]).toMatch(/\.source\.json$/);
    expect(calls).toHaveLength(2);
    // First write is the raw selection text, unwrapped.
    expect(JSON.parse(calls[0]!.body).content).toBe('synthetic selection text');
    // Second write is the sidecar, carrying schema + provenance, not the raw text again.
    const sidecar = JSON.parse(JSON.parse(calls[1]!.body).content);
    expect(sidecar).toMatchObject({ schema: 'bezier-design.browser-capture.v1', captureId: 'cap_synthetic', captureMode: 'selection' });
  });

  it('rejects a non-selection kind instead of writing a partial file', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const result = await persistBrowserCapture('project-1', { ...selectionCapture, kind: 'page' as unknown as 'selection' });

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an empty selection instead of writing an empty file', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const result = await persistBrowserCapture('project-1', { ...selectionCapture, selection: { text: '' } });

    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports failure when the sidecar write fails, even though the main file already saved', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ file: { name: 'collected/selection-a.md', path: 'collected/selection-a.md', size: 0, mtime: 0 } }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: 'disk full' } }), { status: 500 });
    }));

    const result = await persistBrowserCapture('project-1', selectionCapture);

    expect(result.ok).toBe(false);
    expect(result.message).toBe('选区已保存，但来源记录保存失败');
  });

  it('uploads original image bytes as a file, not a json wrapper', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const calls: Array<{ url: string; file: File | null; kind: string | null; rating: string | null }> = [];
    vi.stubGlobal('window', { dispatchEvent: () => true });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, init) => {
      const body = (init as RequestInit).body;
      const file = body instanceof FormData ? body.get('file') : null;
      const kind = body instanceof FormData ? String(body.get('kind') ?? '') : null;
      const rating = body instanceof FormData ? (body.get('rating') as string | null) : null;
      calls.push({ url: String(url), file: file instanceof File ? file : null, kind, rating });
      return new Response(JSON.stringify({ asset: { name: 'hero.png', id: 'a1' } }), { status: 200 });
    }));

    const result = await persistBrowserCapture('project-1', {
      captureId: 'cap_img',
      kind: 'image',
      intent: 'save_personal_asset',
      source: { pageUrl: 'https://example.test/gallery' },
      resource: { url: 'https://example.test/hero.png', mime: 'image/png' },
      payload: { mime: 'image/png', bytes: png, filenameHint: 'hero.png' },
      asset: { name: 'hero.png', rating: 4 },
      capturedAt: '2026-09-20T00:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    expect(result.message).toContain('hero.png');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/api/asset-library/upload');
    expect(calls[0]!.kind).toBe('image');
    expect(calls[0]!.rating).toBe('4');
    expect(calls[0]!.file).toBeInstanceOf(File);
    expect(calls[0]!.file!.type).toBe('image/png');
    expect(new Uint8Array(await calls[0]!.file!.arrayBuffer())).toEqual(png);
  });

  it('uploads selection text through the same personal-asset upload as images', async () => {
    const calls: Array<{ url: string; kind: string | null }> = [];
    vi.stubGlobal('window', { dispatchEvent: () => true });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, init) => {
      const body = (init as RequestInit).body;
      const kind = body instanceof FormData ? String(body.get('kind') ?? '') : null;
      calls.push({ url: String(url), kind });
      return new Response(JSON.stringify({ asset: { name: 'note.md', id: 't1' } }), { status: 200 });
    }));

    const result = await persistBrowserCapture('project-1', {
      ...selectionCapture,
      intent: 'save_personal_asset',
      asset: { name: 'note.md' },
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/api/asset-library/upload');
    expect(calls[0]!.kind).toBe('text');
  });
});
