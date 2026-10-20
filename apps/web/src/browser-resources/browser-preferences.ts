import { useEffect, useSyncExternalStore } from 'react';
import { DEFAULT_BROWSER_CAPTURE_PREFERENCES, normalizeBrowserCapturePreferences, type BrowserCapturePreferences, type BrowserBookmark, type BrowserReferencePreferences } from '@bezier/contracts';

const LEGACY_BOOKMARK_KEY = 'bezier-design:browser-bookmarks:v1';
const SYNC_KEY = 'bezier-design:browser-preferences-revision';
export const DEFAULT_BROWSER_BOOKMARKS: BrowserBookmark[] = [
  { title: 'Pinterest', url: 'https://www.pinterest.com/' }, { title: 'Unsplash', url: 'https://unsplash.com/' },
  { title: 'Behance', url: 'https://www.behance.net/' }, { title: 'Dribbble', url: 'https://dribbble.com/' },
  { title: 'ZCOOL', url: 'https://www.zcool.com.cn/' }, { title: 'Huaban', url: 'https://huaban.com/' },
];
const EMPTY_REFERENCES: BrowserReferencePreferences = { customSites: [], hiddenUrls: [] };
type LocalPreferences = { browserBookmarks?: BrowserBookmark[]; browserReferences?: BrowserReferencePreferences; browserCapture?: BrowserCapturePreferences };

/** Local persistence is untrusted too. Invalid data blocks edits rather than
 * becoming a successful empty catalogue that could overwrite stored bookmarks. */
export function parseBrowserPreferences(raw: string | null): LocalPreferences {
  const value: unknown = raw ? JSON.parse(raw) : {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid browser preferences');
  const config = value as LocalPreferences;
  const validSite = (site: BrowserBookmark) => site && typeof site.title === 'string' && typeof site.url === 'string' && !!browserHttpUrl(site.url);
  if (config.browserBookmarks !== undefined && (!Array.isArray(config.browserBookmarks) || !config.browserBookmarks.every(validSite))) throw new Error('Invalid browser bookmarks');
  const refs = config.browserReferences;
  if (refs !== undefined && (!refs || !Array.isArray(refs.hiddenUrls) || !refs.hiddenUrls.every(url => typeof url === 'string' && !!browserHttpUrl(url)) || !Array.isArray(refs.customSites) || !refs.customSites.every(site => validSite(site) && typeof site.id === 'string' && typeof site.category === 'string' && typeof site.description === 'string'))) throw new Error('Invalid browser references');
  if (config.browserCapture !== undefined && !normalizeBrowserCapturePreferences(config.browserCapture)) throw new Error('Invalid browser capture preferences');
  return config;
}

/** User-entered links may be bare hosts, but may never execute code or include credentials. */
export function browserHttpUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw || raw.length > 2048) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname || url.href.length > 2048 || /^https?:\/\/[^/?#]*@/i.test(raw)) return null;
    return url.href;
  } catch { return null; }
}

function legacyBookmarks(): BrowserBookmark[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LEGACY_BOOKMARK_KEY) || 'null');
    if (!Array.isArray(raw)) return DEFAULT_BROWSER_BOOKMARKS;
    const seen = new Set<string>();
    return raw.flatMap(item => {
      const url = typeof item?.url === 'string' ? browserHttpUrl(item.url) : null;
      if (!url || typeof item.title !== 'string' || !item.title.trim() || seen.has(url)) return [];
      seen.add(url); return [{ title: item.title.trim().slice(0, 120), url }];
    }).slice(0, 100);
  } catch { return DEFAULT_BROWSER_BOOKMARKS; }
}

type State = { bookmarks: BrowserBookmark[]; references: BrowserReferencePreferences; capture: BrowserCapturePreferences; ready: boolean; error: boolean };
let state: State = { bookmarks: DEFAULT_BROWSER_BOOKMARKS, references: EMPTY_REFERENCES, capture: DEFAULT_BROWSER_CAPTURE_PREFERENCES, ready: false, error: false };
const listeners = new Set<() => void>();
let loading: Promise<void> | null = null;
let writes: Promise<unknown> = Promise.resolve();
const getSnapshot = () => state;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const publish = (next: State) => { state = next; for (const listener of listeners) listener(); };

export async function reloadBrowserPreferences(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const stored = localStorage.getItem('canvas-workspace:browser-preferences:v1');
      const config = parseBrowserPreferences(stored);
      publish({ bookmarks: config.browserBookmarks ?? legacyBookmarks(), references: config.browserReferences ?? EMPTY_REFERENCES,
        capture: normalizeBrowserCapturePreferences(config.browserCapture) ?? DEFAULT_BROWSER_CAPTURE_PREFERENCES, ready: true, error: false });
    } catch {
      // Never turn a failed read into a successful empty catalogue or overwrite it.
      publish({ ...state, bookmarks: state.ready ? state.bookmarks : legacyBookmarks(), ready: true, error: true });
    }
  })().finally(() => { loading = null; });
  return loading;
}

export function useBrowserPreferences() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    if (!state.ready) void reloadBrowserPreferences();
    const refresh = () => { void writes.then(reloadBrowserPreferences); };
    const storage = (event: StorageEvent) => { if (event.key === SYNC_KEY) refresh(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('storage', storage); };
  }, []);
  return snapshot;
}

/** Serialize local consumers and re-read before editing; only patch the owned top-level key. */
function update<K extends 'browserBookmarks' | 'browserReferences' | 'browserCapture'>(key: K,
  change: (current: NonNullable<LocalPreferences[K]>) => NonNullable<LocalPreferences[K]>): Promise<void> {
  const task = writes.then(async () => {
    await reloadBrowserPreferences();
    if (state.error) throw new Error('Browser preferences unavailable');
    const current = (key === 'browserBookmarks' ? state.bookmarks : key === 'browserReferences' ? state.references : state.capture) as NonNullable<LocalPreferences[K]>;
    const next = change(current);
    const config = { browserBookmarks: state.bookmarks, browserReferences: state.references, browserCapture: state.capture, [key]: next };
    // A quota/security failure rejects the save; never pretend persistence succeeded.
    localStorage.setItem('canvas-workspace:browser-preferences:v1', JSON.stringify(config));
    if (key === 'browserCapture') {
      const saved = normalizeBrowserCapturePreferences(config.browserCapture);
      const expected = next as BrowserCapturePreferences;
      if (!saved || saved.enabled !== expected.enabled || saved.text !== expected.text || saved.images !== expected.images) throw new Error('Browser did not save capture preferences');
      publish({ ...state, capture: saved, error: false });
    } else {
      publish({ ...state, ...(key === 'browserBookmarks' ? { bookmarks: config.browserBookmarks! } : { references: config.browserReferences! }), error: false });
    }
    try {
      if (key === 'browserBookmarks') localStorage.removeItem(LEGACY_BOOKMARK_KEY);
      localStorage.setItem(SYNC_KEY, `${Date.now()}:${Math.random()}`);
    } catch { /* Persistence already succeeded locally; cross-window hint is optional. */ }
  });
  writes = task.catch(() => undefined);
  return task;
}
export const updateBrowserCapture = (change: (prefs: BrowserCapturePreferences) => BrowserCapturePreferences) => update('browserCapture', change);
export const updateBrowserBookmarks = (change: (items: BrowserBookmark[]) => BrowserBookmark[]) => update('browserBookmarks', change);
export const updateBrowserReferences = (change: (prefs: BrowserReferencePreferences) => BrowserReferencePreferences) => update('browserReferences', change);
