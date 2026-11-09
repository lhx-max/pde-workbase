import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function expandedStyles(file: string, seen = new Set<string>()): string {
  if (seen.has(file)) return '';
  seen.add(file);
  const text = readFileSync(file, 'utf8');
  return text.replace(/@import\s+['"]([^'"]+)['"]\s*;/g, (statement, target: string) =>
    target.startsWith('.') ? expandedStyles(path.resolve(path.dirname(file), target), seen) : statement);
}
const css = expandedStyles(path.resolve('src/index.css'));
it('keeps the frozen vendor-to-global cascade at the root, before client component modules', () => {
  const layout = readFileSync('app/layout.tsx', 'utf8');
  const imports = ['@excalidraw/excalidraw/index.css', '@xyflow/react/dist/style.css', '@bezier/canvas-workbench/styles.css', '@bezier/workbench-ui/styles.css', '../src/index.css'];
  const positions = imports.map(name => layout.indexOf(`import '${name}'`));
  expect(positions.every(position => position >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  expect(readFileSync('src/App.tsx', 'utf8')).not.toContain("import './index.css'");
});
it('loads the original confirmation variant and destructive affordance', () => {
  expect(css).toMatch(/\.modal-confirm\s*\{[^}]*width:\s*420px;/);
  expect(css).toMatch(/\.modal-confirm \.row button\.danger\s*\{[^}]*background:\s*var\(--red\);/);
  expect(css.indexOf('.modal {')).toBeLessThan(css.indexOf('.modal-confirm {'));
});
describe('reachable original shared style closure', () => {
  it('loads the shared accordion collapse and expansion instead of exposing hidden content', () => {
    expect(css).toMatch(/\.accordion-collapsible\s*\{[^}]*display:\s*grid;[^}]*grid-template-rows:\s*0fr;/);
    expect(css).toMatch(/\.accordion-collapsible\.open\s*\{[^}]*grid-template-rows:\s*1fr;/);
    expect(css).toMatch(/\.accordion-collapsible-inner\s*\{[^}]*overflow:\s*hidden;/);
  });
  it('loads the original workflow question form controls and animation closure', () => {
    expect(css).toMatch(/\.question-form\s*\{[^}]*border-radius:\s*12px;/);
    expect(css).toMatch(/\.qf-choice-control\s*\{[^}]*position:\s*absolute;/);
    expect(css).toContain('@keyframes question-form-pulse');
    expect(css).toContain('.question-form-summary-empty');
  });
  it('loads the fixed centered backdrop and modal frame before viewer specializations', () => {
    expect(css).toMatch(/\.modal-backdrop\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*display:\s*flex;/);
    expect(css).toMatch(/\.modal\s*\{[^}]*box-shadow:\s*var\(--shadow-lg\);/);
    expect(css).toMatch(/\.modal-foot\s*\{[^}]*justify-content:\s*flex-end;/);
    expect(css.indexOf('.modal-backdrop {')).toBeLessThan(css.indexOf('.image-export-modal.modal'));
  });
});
