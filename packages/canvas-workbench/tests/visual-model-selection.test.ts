import { describe, expect, it } from 'vitest';
import type { CanvasMediaSnapshot } from '../src/platform/media-catalog';
import { resolveVisualModelSelection } from '../src/workbench/visual-model-routing';

const catalog: CanvasMediaSnapshot = {
  ready: true, video: [], image: [
    {id: 'codex-gpt2', label: 'Codex', provider: 'codex', caps: ['t2i']},
    {id: 'gpt-image-2', label: 'OpenAI', provider: 'openai', caps: ['t2i'], default: true},
  ],
};

describe('visual model selection before submission', () => {
  it('prefers the configured default over catalog order for a new or retired choice', () => {
    for (const model of [undefined, 'gpt2', 'gemini']) {
      expect(resolveVisualModelSelection(model, catalog)).toBe('gpt-image-2');
    }
  });
  it('retains a usable explicit choice even when another model is the default', () => {
    expect(resolveVisualModelSelection('codex-gpt2', catalog)).toBe('codex-gpt2');
  });
  it('uses the first available model when none is marked as default', () => {
    const available = {...catalog, image: catalog.image.map(model => ({...model, default: false}))};
    expect(resolveVisualModelSelection('gpt2', available)).toBe('codex-gpt2');
  });
  it('waits for discovery before replacing the saved choice', () => {
    expect(resolveVisualModelSelection('gpt2', {...catalog, ready: false})).toBe('gpt2');
  });
  it('does not pretend a configured model exists when discovery has no choices', () => {
    expect(resolveVisualModelSelection('gpt2', {...catalog, image: []})).toBe('gpt2');
  });
});
