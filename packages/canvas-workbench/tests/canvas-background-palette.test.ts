import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles/canvas-foundation.css', import.meta.url), 'utf8');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];

function sharedPaletteRule(surface: string, preview: string) {
  return rules.find(([, selectors]) => selectors?.includes(surface) && selectors.includes(preview))?.[2];
}

describe('canvas appearance palette', () => {
  it('uses the host header surface for both the default canvas and its preview', () => {
    expect(sharedPaletteRule('.canvas-workbench .xy-flow-host', "[data-pattern][data-tone='default']"))
      .toContain('background-color: var(--bg-panel, var(--bg-surface))');
  });

  it('reuses the previous canvas gray for both warm-gray surfaces', () => {
    expect(css).toMatch(/--bg-app:\s*#f2f2f2;/);
    expect(sharedPaletteRule(".xy-flow-host[data-canvas-tone='warm-gray']", "[data-pattern][data-tone='warm-gray']"))
      .toContain('background-color: var(--bg-app)');
  });
});
