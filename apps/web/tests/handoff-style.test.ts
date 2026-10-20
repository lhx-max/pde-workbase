import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const css = readFileSync(new URL('../src/styles/viewer/routines.css', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../src/styles/workspace/standalone-shell.css', import.meta.url), 'utf8');

test('retained handoff leaves accept the independent project chrome ancestor', () => {
  for (const name of ['handoff-wrap', 'handoff-trigger', 'handoff-trigger--solo', 'handoff-trigger-label', 'handoff-menu-error']) {
    expect(css).toContain(`:is(.app, [data-project-chrome]) .${name} {`);
  }
});

test('neutral standalone handoff keeps its complete action label, not an icon-only width', () => {
  expect(shell).toMatch(/\.standalone-workspace-root \.handoff-trigger--solo\s*\{\s*width:\s*auto;/);
});
