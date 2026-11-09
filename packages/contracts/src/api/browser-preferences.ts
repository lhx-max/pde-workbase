import { normalizeBrowserCapturePreferences, type BrowserBookmark, type BrowserCapturePreferences, type BrowserReferencePreferences } from './app-config.js';

/** Browser-owned settings only: never credentials, agent settings or account state. */
export interface CanvasBrowserPreferences {
  browserBookmarks?: BrowserBookmark[];
  browserReferences?: BrowserReferencePreferences;
  browserCapture?: BrowserCapturePreferences;
}
export interface CanvasBrowserPreferencesSnapshot { revision: number; preferences: CanvasBrowserPreferences }
export interface CanvasBrowserPreferencesUpdate { revision: number; patch: CanvasBrowserPreferences }

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, max: number, empty = false): value is string {
  return typeof value === 'string' && value.length <= max && (empty || !!value.trim());
}
function url(value: unknown): value is string {
  if (!text(value, 2048) || !/^https?:\/\//i.test(value)) return false;
  try { const parsed = new URL(value); return ['http:', 'https:'].includes(parsed.protocol) && !!parsed.hostname && !parsed.username && !parsed.password && !/^https?:\/\/[^/?#]*@/i.test(value); } catch { return false; }
}
function bookmark(value: unknown): value is BrowserBookmark { return record(value) && text(value.title, 200) && url(value.url); }

/** Validate before read or merge, so malformed persisted state cannot be silently erased. */
export function parseCanvasBrowserPreferences(value: unknown): CanvasBrowserPreferences {
  if (!record(value) || Object.keys(value).some(key => !['browserBookmarks', 'browserReferences', 'browserCapture'].includes(key))) throw new Error('Invalid browser preferences');
  const result: CanvasBrowserPreferences = {};
  if (value.browserBookmarks !== undefined) {
    if (!Array.isArray(value.browserBookmarks) || value.browserBookmarks.length > 500 || !value.browserBookmarks.every(bookmark)) throw new Error('Invalid browser bookmarks');
    result.browserBookmarks = value.browserBookmarks.map(({ title, url }) => ({ title, url }));
  }
  if (value.browserReferences !== undefined) {
    const refs = value.browserReferences;
    if (!record(refs) || !Array.isArray(refs.hiddenUrls) || refs.hiddenUrls.length > 1000 || !refs.hiddenUrls.every(url)
      || !Array.isArray(refs.customSites) || refs.customSites.length > 500
      || !refs.customSites.every(site => bookmark(site) && record(site) && text(site.id, 200) && text(site.category, 200) && text(site.description, 4000, true))) throw new Error('Invalid browser references');
    result.browserReferences = { hiddenUrls: [...refs.hiddenUrls], customSites: refs.customSites.map(site => ({ id: site.id as string, title: site.title, url: site.url, category: site.category as string, description: site.description as string })) };
  }
  if (value.browserCapture !== undefined) {
    const capture = normalizeBrowserCapturePreferences(value.browserCapture);
    if (!capture) throw new Error('Invalid browser capture preferences');
    result.browserCapture = capture;
  }
  return result;
}
