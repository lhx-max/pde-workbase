import { describe, it, expect, vi } from 'vitest';
import { createSketchPreviewChannel, sketchPreviewKey } from '../src/state/sketch-preview-channel';

describe('sketch preview channel', () => {
  it('scope、project、path 任一不同都产生不同 key', () => {
    const base = sketchPreviewKey('scope', 'project', 'path');
    const otherScope = sketchPreviewKey('other-scope', 'project', 'path');
    const otherProject = sketchPreviewKey('scope', 'other-project', 'path');
    const otherPath = sketchPreviewKey('scope', 'project', 'other-path');

    expect(otherScope).not.toBe(base);
    expect(otherProject).not.toBe(base);
    expect(otherPath).not.toBe(base);
    expect(new Set([base, otherScope, otherProject, otherPath]).size).toBe(4);

    const channel = createSketchPreviewChannel();
    channel.publish(base, 'only-base');
    expect(channel.read(base)).toBe('only-base');
    expect(channel.read(otherScope)).toBeUndefined();
    expect(channel.read(otherProject)).toBeUndefined();
    expect(channel.read(otherPath)).toBeUndefined();
  });

  it('publish 后 read 返回逐字相同 content，另一个 key 不受影响', () => {
    const channel = createSketchPreviewChannel();
    const key = sketchPreviewKey('actor', 'project', 'canvas/a');
    const other = sketchPreviewKey('actor', 'project', 'canvas/b');
    const content = 'line-1\n  indented\u2603 "quotes"';

    channel.publish(other, 'other-snapshot');
    channel.publish(key, content);

    expect(channel.read(key)).toBe(content);
    expect(channel.read(other)).toBe('other-snapshot');
  });

  it('同内容重复 publish 不再通知 listener，内容改变才通知', () => {
    const channel = createSketchPreviewChannel();
    const key = sketchPreviewKey('actor', 'project', 'canvas');
    const listener = vi.fn();
    channel.subscribe(key, listener);

    channel.publish(key, 'v1');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(channel.read(key)).toBe('v1');

    channel.publish(key, 'v1');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(channel.read(key)).toBe('v1');

    channel.publish(key, 'v2');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(channel.read(key)).toBe('v2');
  });

  it('unsubscribe 后 listener 不再收到变化', () => {
    const channel = createSketchPreviewChannel();
    const key = sketchPreviewKey('actor', 'project', 'canvas');
    const listener = vi.fn();
    const stillListening = vi.fn();
    const unsubscribe = channel.subscribe(key, listener);
    channel.subscribe(key, stillListening);

    channel.publish(key, 'first');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(stillListening).toHaveBeenCalledTimes(1);

    unsubscribe();
    channel.publish(key, 'second');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(stillListening).toHaveBeenCalledTimes(2);
    expect(channel.read(key)).toBe('second');
  });

  it('limit=2 时依次 publish a、b、c 会删除 a 并通知 a 的订阅者，b 和 c 仍在', () => {
    const channel = createSketchPreviewChannel(2);
    const keyA = sketchPreviewKey('actor', 'project', 'a');
    const keyB = sketchPreviewKey('actor', 'project', 'b');
    const keyC = sketchPreviewKey('actor', 'project', 'c');
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    const listenerC = vi.fn();
    channel.subscribe(keyA, listenerA);
    channel.subscribe(keyB, listenerB);
    channel.subscribe(keyC, listenerC);

    channel.publish(keyA, 'snapshot-a');
    channel.publish(keyB, 'snapshot-b');
    expect(listenerA).toHaveBeenCalledTimes(1);
    expect(listenerB).toHaveBeenCalledTimes(1);

    channel.publish(keyC, 'snapshot-c');
    expect(channel.read(keyA)).toBeUndefined();
    expect(channel.read(keyB)).toBe('snapshot-b');
    expect(channel.read(keyC)).toBe('snapshot-c');
    expect(listenerA).toHaveBeenCalledTimes(2);
    expect(listenerB).toHaveBeenCalledTimes(1);
    expect(listenerC).toHaveBeenCalledTimes(1);
  });

  it('remove 只清目标，移除不存在的 key 不通知', () => {
    const channel = createSketchPreviewChannel();
    const key = sketchPreviewKey('actor', 'project', 'target');
    const other = sketchPreviewKey('actor', 'project', 'other');
    const missing = sketchPreviewKey('actor', 'project', 'missing');
    const listener = vi.fn();
    const otherListener = vi.fn();
    const missingListener = vi.fn();

    channel.publish(key, 'doomed');
    channel.publish(other, 'kept');
    channel.subscribe(key, listener);
    channel.subscribe(other, otherListener);
    channel.subscribe(missing, missingListener);

    channel.remove(key);
    expect(channel.read(key)).toBeUndefined();
    expect(channel.read(other)).toBe('kept');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(otherListener).toHaveBeenCalledTimes(0);

    channel.remove(missing);
    expect(missingListener).toHaveBeenCalledTimes(0);
    expect(channel.read(other)).toBe('kept');
    expect(channel.read(key)).toBeUndefined();
  });
});
