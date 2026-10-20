import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasBrowserPreferencesSnapshot, CanvasBrowserPreferencesUpdate } from '@bezier/contracts';

let saved: CanvasBrowserPreferencesSnapshot;
let values: Map<string, string>;
let requests: CanvasBrowserPreferencesUpdate[];
let beforePut: (() => void) | undefined;
let failRead = false;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  vi.resetModules(); values = new Map(); requests = []; saved = { revision: 0, preferences: {} }; beforePut = undefined; failRead = false;
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('/api/browser-preferences');
    if (init?.method !== 'PUT') return failRead ? json({ error: 'Offline' }, 503) : json(saved);
    const input = JSON.parse(String(init.body)) as CanvasBrowserPreferencesUpdate; requests.push(input); beforePut?.(); beforePut = undefined;
    if (input.revision !== saved.revision) return json({ error: { code: 'BROWSER_PREFERENCES_CONFLICT', message: 'Changed' } }, 409);
    saved = { revision: saved.revision + 1, preferences: { ...saved.preferences, ...input.patch } }; return json(saved);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('browser preference HTTP persistence', () => {
  it('serializes owned-key edits without dropping another preference domain', async () => {
    const api = await import('../src/browser-resources/browser-preferences');
    await Promise.all([api.updateBrowserBookmarks(() => [{ title: 'Saved', url: 'https://example.com/' }]), api.updateBrowserCapture(() => ({ enabled: false, text: true, images: false }))]);
    expect(saved.revision).toBe(2);
    expect(saved.preferences.browserBookmarks?.[0]?.title).toBe('Saved');
    expect(saved.preferences.browserCapture?.enabled).toBe(false);
    expect(Object.keys(requests[1]!.patch)).toEqual(['browserCapture']);
  });
  it('re-reads and retries a conflicting writer instead of erasing its unrelated key', async () => {
    const api = await import('../src/browser-resources/browser-preferences');
    beforePut = () => { saved = { revision: 1, preferences: { browserReferences: { customSites: [], hiddenUrls: ['https://hidden.example/'] } } }; };
    await api.updateBrowserBookmarks(() => []);
    expect(requests).toHaveLength(2);
    expect(saved.preferences).toEqual({ browserBookmarks: [], browserReferences: { customSites: [], hiddenUrls: ['https://hidden.example/'] } });
  });
  it('migrates the previous local-only preferences once after successful durable storage', async () => {
    values.set('canvas-workspace:browser-preferences:v1', JSON.stringify({ browserBookmarks: [{ title: 'Old origin', url: 'https://example.com/' }] }));
    const api = await import('../src/browser-resources/browser-preferences');
    await api.reloadBrowserPreferences(); await api.reloadBrowserPreferences();
    expect(requests).toHaveLength(1);
    expect(saved.preferences.browserBookmarks?.[0]?.title).toBe('Old origin');
    expect(values.has('canvas-workspace:browser-preferences:v1')).toBe(false);
  });
  it('keeps the local backup if another client wins the migration race', async () => {
    values.set('canvas-workspace:browser-preferences:v1', JSON.stringify({ browserBookmarks: [{ title: 'Local backup', url: 'https://local.example/' }] }));
    beforePut = () => { saved = { revision: 1, preferences: { browserBookmarks: [] } }; };
    const api = await import('../src/browser-resources/browser-preferences');
    await api.reloadBrowserPreferences();
    expect(saved.preferences.browserBookmarks).toEqual([]);
    expect(values.has('canvas-workspace:browser-preferences:v1')).toBe(true);
  });
  it('does not migrate over an existing server profile or resurrect intentionally empty bookmarks', async () => {
    saved = { revision: 4, preferences: { browserBookmarks: [] } };
    values.set('canvas-workspace:browser-preferences:v1', JSON.stringify({ browserBookmarks: [{ title: 'Stale', url: 'https://stale.example/' }] }));
    const api = await import('../src/browser-resources/browser-preferences');
    await api.updateBrowserBookmarks(current => { expect(current).toEqual([]); return current; });
    expect(saved.preferences.browserBookmarks).toEqual([]);
    expect(requests).toHaveLength(1);
  });
  it('rejects saves after a failed authoritative read, never turning failure into empty success', async () => {
    failRead = true;
    const api = await import('../src/browser-resources/browser-preferences');
    await expect(api.updateBrowserBookmarks(() => [])).rejects.toThrow('unavailable');
    expect(requests).toEqual([]);
  });
  it('does not overwrite corrupt authoritative settings', async () => {
    saved = { revision: 1, preferences: { browserBookmarks: null } } as never;
    const api = await import('../src/browser-resources/browser-preferences');
    await expect(api.updateBrowserCapture(() => ({ enabled: true, text: true, images: true }))).rejects.toThrow('unavailable');
    expect(requests).toEqual([]);
  });
  it('does not confuse optional cross-window storage hint failure with a failed HTTP save', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('Quota'); }, removeItem: () => undefined });
    const api = await import('../src/browser-resources/browser-preferences');
    await api.updateBrowserBookmarks(() => []);
    expect(saved).toEqual({ revision: 1, preferences: { browserBookmarks: [] } });
  });
});
