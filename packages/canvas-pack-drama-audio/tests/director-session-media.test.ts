// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertMediaSize, requireMedia, useSessionMedia } from '../src/director/media';

function sized(name: string, size: number, content = 'x') {
  const file = new File([content], name);
  Object.defineProperty(file, 'size', { value: size });
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(content).buffer });
  return file;
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

let created: string[];
let revoked: string[];

beforeEach(() => {
  created = [];
  revoked = [];
  let next = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { const url = `blob:test/${next++}`; created.push(url); return url; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => { revoked.push(url); });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('素材大小与解析', () => {
  it('单个文件须为 1 字节到 30 MB', () => {
    expect(() => assertMediaSize(sized('a.wav', 0))).toThrow(/30 MB/);
    expect(() => assertMediaSize(sized('a.wav', 30_000_001))).toThrow(/30 MB/);
    expect(() => assertMediaSize(sized('a.wav', 1))).not.toThrow();
    expect(() => assertMediaSize(sized('a.wav', 30_000_000))).not.toThrow();
  });

  it('素材未载入时提示文件名', () => {
    expect(requireMedia(ref => `blob:${ref}`, 'a/b.wav')).toBe('blob:a/b.wav');
    expect(() => requireMedia(() => undefined, 'card-assets/x/配音.wav')).toThrow('素材尚未载入：配音.wav。请在素材面板恢复文件。');
  });
});

describe('会话素材缓存', () => {
  it('按内容摘要生成引用，同一文件只创建一个对象 URL', async () => {
    const { result } = renderHook(() => useSessionMedia());
    const hash = await sha256('voice');
    let ref = '';
    await act(async () => { ref = await result.current.add(sized('配/音:1.wav', 10, 'voice')); });
    expect(ref).toBe(`card-assets/drama-audio/session/${hash}/配_音:1.wav`);
    expect(result.current.resolve(ref)).toBe('blob:test/0');
    expect(result.current.version).toBe(1);
    await act(async () => { expect(await result.current.add(sized('配/音:1.wav', 10, 'voice'))).toBe(ref); });
    expect(created).toEqual(['blob:test/0']);
    expect(result.current.version).toBe(1);
    expect(result.current.resolve('unknown')).toBeUndefined();
  });

  it('不安全或过长文件名被规范化', async () => {
    const { result } = renderHook(() => useSessionMedia());
    let dots = '';
    let long = '';
    await act(async () => {
      dots = await result.current.add(sized('..', 5, 'dots'));
      long = await result.current.add(sized(`${'a'.repeat(200)}.wav`, 5, 'long'));
    });
    expect(dots.endsWith('/media')).toBe(true);
    expect(long.split('/').at(-1)).toHaveLength(120);
  });

  it('恢复时只匹配工程里已有的同内容引用', async () => {
    const { result } = renderHook(() => useSessionMedia());
    const hash = await sha256('take');
    const saved = `card-assets/drama-audio/session/${hash}/原名.wav`;
    let restored: string | undefined;
    let missing: string | undefined = 'x';
    await act(async () => {
      restored = await result.current.restore(sized('改名.wav', 4, 'take'), new Set([42, 'other', saved]));
      missing = await result.current.restore(sized('other.wav', 4, 'different'), new Set([saved]));
    });
    expect(restored).toBe(saved);
    expect(result.current.resolve(saved)).toBe('blob:test/0');
    expect(missing).toBeUndefined();
    expect(created).toHaveLength(1);
  });

  it('会话总量超过 180 MB 时拒绝新增', async () => {
    const { result } = renderHook(() => useSessionMedia());
    await act(async () => {
      for (let i = 0; i < 6; i++) await result.current.add(sized(`${i}.mp4`, 30_000_000, `big-${i}`));
    });
    await expect(result.current.add(sized('7.mp4', 1, 'tiny'))).rejects.toThrow(/180 MB/);
    await expect(result.current.add(sized('huge.mp4', 30_000_001, 'huge'))).rejects.toThrow(/30 MB/);
  });

  it('卸载后释放全部对象 URL，并拒绝继续添加', async () => {
    const { result, unmount } = renderHook(() => useSessionMedia());
    await act(async () => {
      await result.current.add(sized('a.wav', 3, 'a'));
      await result.current.add(sized('b.wav', 3, 'b'));
    });
    const { add } = result.current;
    unmount();
    expect(revoked.sort()).toEqual(['blob:test/0', 'blob:test/1']);
    await expect(add(sized('c.wav', 3, 'c'))).rejects.toThrow(/已关闭/);
  });
});
