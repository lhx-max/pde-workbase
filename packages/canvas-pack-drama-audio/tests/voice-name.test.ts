import { describe, expect, it } from 'vitest';
import { voiceName } from '../src/voice-picker';

describe('音色简称', () => {
  it.each([
    [null, '默认解说'],
    ['  ', '默认解说'],
    ['浑厚沉稳的男声，咬字清晰', '浑厚男声'],
    ['带点笑意的少年音', '带点笑意的少年音'],
    ['一个非常非常长的自定义音色描述文字', '一个非常非常长的自定义音…'],
  ])('%s → %s', (input, expected) => {
    expect(voiceName(input)).toBe(expected);
  });
});
