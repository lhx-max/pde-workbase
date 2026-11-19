import { describe, expect, it } from 'vitest';
import { effectiveLineVoice, lineGenerationCurrent } from '../src/dubbing';

describe('逐句配音状态', () => {
  it('逐句音色覆盖整体，继承整体变化会使缓存过期', () => {
    const data = { voiceInstruction: '温柔女声', lineVoiceInstructions: { a: '沉稳男声' },
      generatedLineTexts: { a: '第一句', b: '第二句' }, generatedLineVoices: { a: '沉稳男声', b: '温柔女声' } };
    expect(effectiveLineVoice(data, 'a')).toBe('沉稳男声');
    expect(effectiveLineVoice(data, 'b')).toBe('温柔女声');
    expect(lineGenerationCurrent(data, 'a', '第一句')).toBe(true);
    expect(lineGenerationCurrent({ ...data, voiceInstruction: '少女声音' }, 'a', '第一句')).toBe(true);
    expect(lineGenerationCurrent({ ...data, voiceInstruction: '少女声音' }, 'b', '第二句')).toBe(false);
    expect(lineGenerationCurrent({ ...data, lineGains: { a: 0.5 } }, 'a', '第一句')).toBe(true);
    expect(lineGenerationCurrent({ generatedLineTexts: { a: '第一句' } }, 'a', '第一句')).toBe(false);
  });
});
