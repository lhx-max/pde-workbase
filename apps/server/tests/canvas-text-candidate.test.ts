import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isUsableStoryboardCandidate, saveCanvasTextCandidate } from '../src/canvas/text-candidate.js';

describe('immutable canvas candidates', () => {
  it('accepts usable storyboard JSON but rejects malformed or empty shots', () => {
    expect(isUsableStoryboardCandidate('```json\n{"shots":[{"description":"清晨街道"}]}\n```')).toBe(true);
    expect(isUsableStoryboardCandidate('{"shots":[]}')).toBe(false);
    expect(isUsableStoryboardCandidate('{"shots":[{"description":" "}]}')).toBe(false);
    expect(isUsableStoryboardCandidate('模型没有返回 JSON')).toBe(false);
  });
  let root: string;
  beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'canvas-candidate-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });
  it('persists readable output and replays without overwriting', () => {
    const file = saveCanvasTextCandidate(root, '../../run', '分镜正文');
    expect(readFileSync(path.join(root, file), 'utf8')).toBe('分镜正文');
    expect(saveCanvasTextCandidate(root, '../../run', '分镜正文')).toBe(file);
    expect(() => saveCanvasTextCandidate(root, '../../run', '另一份')).toThrow('拒绝覆盖');
    expect(readFileSync(path.join(root, file), 'utf8')).toBe('分镜正文');
  });
  it('rejects empty output and a redirected output directory', () => {
    expect(() => saveCanvasTextCandidate(root, 'r', '  ')).toThrow();
    symlinkSync(root, path.join(root, '.bezierdesign'));
    expect(() => saveCanvasTextCandidate(root, 'r', 'text')).toThrow('symbolic links');
  });
});
