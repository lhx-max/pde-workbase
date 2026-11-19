import { useCallback, useEffect, useReducer, useRef } from 'react';

export type MediaLookup = (ref: string) => string | undefined;

const FILE_LIMIT = 30_000_000;
const SESSION_LIMIT = 180_000_000;
const SESSION_PREFIX = 'card-assets/drama-audio/session';

export function assertMediaSize(file: File) {
  if (file.size < 1 || file.size > FILE_LIMIT) throw new Error('单个视频或音频文件须在 30 MB 以内。');
}

export function requireMedia(resolve: MediaLookup, ref: string): string {
  const source = resolve(ref);
  if (!source) throw new Error(`素材尚未载入：${ref.split('/').at(-1)}。请在素材面板恢复文件。`);
  return source;
}

/**
 * 本机媒体缓存：导入和生成的音视频按内容哈希存入浏览器 IndexedDB，重新打开编辑器时自动恢复。
 * 只是同一浏览器里的缓存，卡片数据不变；不可用（隐私模式、配额不足）时静默跳过。
 */
const CACHE_DB = 'drama-audio-media';
const CACHE_STORE = 'files';
const CACHE_LIMIT = 600_000_000;
type CachedFile = { blob: Blob; bytes: number; savedAt: number };

function openCache(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const request = indexedDB.open(CACHE_DB, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore(CACHE_STORE); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function cachePut(ref: string, blob: Blob): Promise<void> {
  const db = await openCache();
  if (!db) return;
  try {
    const write = db.transaction(CACHE_STORE, 'readwrite');
    write.objectStore(CACHE_STORE).put({ blob, bytes: blob.size, savedAt: Date.now() } satisfies CachedFile, ref);
    await done(write);
    // 超过上限时删除最早保存的文件。
    const entries: { key: string; bytes: number; savedAt: number }[] = [];
    const scan = db.transaction(CACHE_STORE, 'readonly');
    const cursor = scan.objectStore(CACHE_STORE).openCursor();
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (!item) return;
      const value = item.value as CachedFile;
      entries.push({ key: String(item.key), bytes: value.bytes, savedAt: value.savedAt });
      item.continue();
    };
    await done(scan);
    let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    if (total <= CACHE_LIMIT) return;
    const prune = db.transaction(CACHE_STORE, 'readwrite');
    for (const entry of entries.sort((a, b) => a.savedAt - b.savedAt)) {
      if (total <= CACHE_LIMIT || entry.key === ref) continue;
      prune.objectStore(CACHE_STORE).delete(entry.key);
      total -= entry.bytes;
    }
    await done(prune);
  } catch { /* 缓存失败不影响编辑。 */ } finally { db.close(); }
}

export async function cacheGet(ref: string): Promise<Blob | null> {
  const db = await openCache();
  if (!db) return null;
  try {
    const read = db.transaction(CACHE_STORE, 'readonly');
    const request = read.objectStore(CACHE_STORE).get(ref);
    await done(read);
    const value = request.result as CachedFile | undefined;
    return value?.blob instanceof Blob ? value.blob : null;
  } catch { return null; } finally { db.close(); }
}

export function useSessionMedia() {
  const entries = useRef(new Map<string, { url: string; bytes: number }>());
  const live = useRef(true);
  const [version, updated] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    live.current = true;
    const current = entries.current;
    return () => {
      live.current = false;
      for (const entry of current.values()) URL.revokeObjectURL(entry.url);
      current.clear();
    };
  }, []);

  const resolve = useCallback<MediaLookup>(ref => entries.current.get(ref)?.url, []);
  const add = useCallback(async (file: File, knownRefs?: Set<unknown>) => {
    assertMediaSize(file);
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const name = file.name.replace(/[\\/\p{Cc}]/gu, '_').slice(-120);
    const prefix = `${SESSION_PREFIX}/${id}/`;
    const restored = knownRefs && [...knownRefs].find((value): value is string => typeof value === 'string' && value.startsWith(prefix));
    if (knownRefs && !restored) return undefined;
    const ref = restored || `${prefix}${name && name !== '.' && name !== '..' ? name : 'media'}`;
    if (!live.current) throw new Error('配音编辑器已关闭。');
    if (!entries.current.has(ref)) {
      const total = [...entries.current.values()].reduce((size, entry) => size + entry.bytes, 0);
      if (total + file.size > SESSION_LIMIT) throw new Error('本次会话素材已超过 180 MB。请先导出，再重新打开画布恢复所需素材。');
      entries.current.set(ref, { url: URL.createObjectURL(file), bytes: file.size });
      updated();
      void cachePut(ref, file);
    }
    return ref;
  }, []);

  /** 从本机缓存恢复卡片引用的素材，返回恢复的数量。 */
  const restoreCached = useCallback(async (refs: Iterable<unknown>) => {
    let restored = 0;
    for (const ref of new Set(refs)) {
      if (typeof ref !== 'string' || !ref.startsWith(`${SESSION_PREFIX}/`) || entries.current.has(ref)) continue;
      const blob = await cacheGet(ref);
      if (!blob || !live.current) continue;
      const total = [...entries.current.values()].reduce((size, entry) => size + entry.bytes, 0);
      if (total + blob.size > SESSION_LIMIT) break;
      entries.current.set(ref, { url: URL.createObjectURL(blob), bytes: blob.size });
      restored++;
    }
    if (restored) updated();
    return restored;
  }, []);

  return { resolve, version,
    add: async (file: File) => (await add(file))!,
    restore: (file: File, refs: Set<unknown>) => add(file, refs),
    restoreCached,
  };
}
