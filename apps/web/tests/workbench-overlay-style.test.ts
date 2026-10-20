import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

it('loads the original overlay host CSS from its actual consumer, not the removed Home page', () => {
  const component = path.resolve('src/components/home-hero/WorkbenchOverlayShells.tsx');
  const source = readFileSync(component, 'utf8');
  const css = [...source.matchAll(/import\s+['"]([^'"]+\.css)['"]/g)]
    .map(match => readFileSync(path.resolve(path.dirname(component), match[1]!), 'utf8')).join('\n');
  expect(/\.home-workbench-popover\s*\{[^}]*width:\s*auto;[^}]*padding:\s*0;/.test(css)).toBe(true);
  expect(/\.home-workbench-popover__scope\.canvas-workbench\s*\{[^}]*background:\s*transparent;/.test(css)).toBe(true);
  for (const selector of ['.home-workbench-dialog-overlay', '.workbench-domain-dialog__scope', '.workbench-host-menu.canvas-tidy-menu']) {
    expect(css.includes(selector), `Missing original overlay contract: ${selector}`).toBe(true);
  }
});
