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
    }
    return ref;
  }, []);

  return { resolve, version,
    add: async (file: File) => (await add(file))!,
    restore: (file: File, refs: Set<unknown>) => add(file, refs),
  };
}
