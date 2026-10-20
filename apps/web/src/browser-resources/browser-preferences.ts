import { useEffect, useSyncExternalStore } from 'react';
import { DEFAULT_BROWSER_CAPTURE_PREFERENCES, parseCanvasBrowserPreferences, type CanvasBrowserPreferences, type CanvasBrowserPreferencesSnapshot, type BrowserCapturePreferences, type BrowserBookmark, type BrowserReferencePreferences } from '@bezier/contracts';
import { requestJson, WorkspaceApiError } from '../providers/registry';

const LEGACY_BOOKMARK_KEY = 'bezier-design:browser-bookmarks:v1';
const SYNC_KEY = 'bezier-design:browser-preferences-revision';
export const DEFAULT_BROWSER_BOOKMARKS: BrowserBookmark[] = [
  { title: 'Pinterest', url: 'https://www.pinterest.com/' }, { title: 'Unsplash', url: 'https://unsplash.com/' },
  { title: 'Behance', url: 'https://www.behance.net/' }, { title: 'Dribbble', url: 'https://dribbble.com/' },
  { title: 'ZCOOL', url: 'https://www.zcool.com.cn/' }, { title: 'Huaban', url: 'https://huaban.com/' },
];
const EMPTY_REFERENCES: BrowserReferencePreferences = { customSites: [], hiddenUrls: [] };
type LocalPreferences = CanvasBrowserPreferences;
const PREFERENCES_ENDPOINT = '/api/browser-preferences';
const PREVIOUS_LOCAL_KEY = 'canvas-workspace:browser-preferences:v1';

/** Local persistence is untrusted too. Invalid data blocks edits rather than
 * becoming a successful empty catalogue that could overwrite stored bookmarks. */
export function parseBrowserPreferences(raw: string | null): LocalPreferences {
  return parseCanvasBrowserPreferences(raw ? JSON.parse(raw) : {});
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
let revision = 0;
function snapshot(value: CanvasBrowserPreferencesSnapshot): CanvasBrowserPreferencesSnapshot {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('Invalid browser preference revision');
  return { revision: value.revision, preferences: parseCanvasBrowserPreferences(value.preferences) };
}
async function readRemote() { return snapshot(await requestJson<CanvasBrowserPreferencesSnapshot>(PREFERENCES_ENDPOINT, { cache: 'no-store' })); }
async function writeRemote(expectedRevision: number, patch: CanvasBrowserPreferences) {
  return snapshot(await requestJson<CanvasBrowserPreferencesSnapshot>(PREFERENCES_ENDPOINT, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: expectedRevision, patch: parseCanvasBrowserPreferences(patch) }) }));
}
function accept(saved: CanvasBrowserPreferencesSnapshot) {
  revision = saved.revision;
  publish({ bookmarks: saved.preferences.browserBookmarks ?? DEFAULT_BROWSER_BOOKMARKS,
    references: saved.preferences.browserReferences ?? EMPTY_REFERENCES,
    capture: saved.preferences.browserCapture ?? DEFAULT_BROWSER_CAPTURE_PREFERENCES, ready: true, error: false });
}
const getSnapshot = () => state;
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const publish = (next: State) => { state = next; for (const listener of listeners) listener(); };

export async function reloadBrowserPreferences(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      let saved = await readRemote();
      if (saved.revision === 0) {
        let stored: string | null = null; let legacy: string | null = null;
        try { stored = localStorage.getItem(PREVIOUS_LOCAL_KEY); legacy = localStorage.getItem(LEGACY_BOOKMARK_KEY); } catch { /* Storage access is not required for authoritative HTTP preferences. */ }
        const migration = stored ? parseBrowserPreferences(stored) : legacy ? { browserBookmarks: legacyBookmarks() } : null;
        if (migration) {
          let migrated = false;
          try { saved = await writeRemote(0, migration); migrated = true; }
          catch (error) { if (error instanceof WorkspaceApiError && error.status === 409) saved = await readRemote(); else throw error; }
          if (migrated) {
            try { localStorage.removeItem(PREVIOUS_LOCAL_KEY); localStorage.removeItem(LEGACY_BOOKMARK_KEY); } catch { /* Successful durable persistence is authoritative. */ }
          }
        }
      }
      accept(saved);
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

/** Serialize consumers, merge only the owned key, and retry optimistic conflicts after a fresh read. */
function update<K extends 'browserBookmarks' | 'browserReferences' | 'browserCapture'>(key: K,
  change: (current: NonNullable<LocalPreferences[K]>) => NonNullable<LocalPreferences[K]>): Promise<void> {
  const task = writes.then(async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      await reloadBrowserPreferences();
      if (state.error) throw new Error('Browser preferences unavailable');
      const current = (key === 'browserBookmarks' ? state.bookmarks : key === 'browserReferences' ? state.references : state.capture) as NonNullable<LocalPreferences[K]>;
      const next = change(current);
      try { accept(await writeRemote(revision, { [key]: next })); }
      catch (error) { if (error instanceof WorkspaceApiError && error.status === 409 && attempt < 3) continue; throw error; }
      try { localStorage.setItem(SYNC_KEY, `${Date.now()}:${Math.random()}`); } catch { /* Cross-window hints are optional; persistence already succeeded remotely. */ }
      return;
    }
  });
  writes = task.catch(() => undefined);
  return task;
}
export const updateBrowserCapture = (change: (prefs: BrowserCapturePreferences) => BrowserCapturePreferences) => update('browserCapture', change);
export const updateBrowserBookmarks = (change: (items: BrowserBookmark[]) => BrowserBookmark[]) => update('browserBookmarks', change);
export const updateBrowserReferences = (change: (prefs: BrowserReferencePreferences) => BrowserReferencePreferences) => update('browserReferences', change);
