import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';

const source = (file: string) => readFileSync(path.resolve('src', file), 'utf8');
function expanded(file: string, seen = new Set<string>()): string {
  if (seen.has(file)) return '';
  seen.add(file);
  return source(file).replace(/@import\s+['"]([^'"]+)['"]\s*;/g, (statement, target: string) =>
    target.startsWith('.') ? expanded(path.join(path.dirname(file), target), seen) : statement);
}
function ownedCss(component: string): string {
  const imports = [...source(component).matchAll(/import\s+['"]([^'"]+\.css)['"];?/g)];
  return imports.map(([, target]) => expanded(path.join(path.dirname(component), target))).join('\n');
}
function rule(css: string, selector: string): string {
  const matches: string[] = [];
  postcss.parse(css).walkRules(selector, node => { matches.push(node.toString()); });
  return matches.join('\n');
}

// Frozen 319e5eee source spans, joined with one newline; no runtime/upstream
// checkout dependency. Hashes guard declarations, comments, whitespace and order.
const extracts = [
  ['components/asset-library/AssetCardShared.css', '81dee886b3cc58a2c89c3d72da7d5e8572c33e0ecc000b58bebbe02fab23c745'],
  ['styles/viewer/deployment.css', 'c95b6d770fafd616b96cfba2b6521d1f3ae480743ba3493aa584f3bd167262bd'],
  ['components/asset-library/AssetMediaSurface.css', '0dd5b9a1d6251ae5b8b6fc33064eb0b26364295f88d7e622ad367d599daaed76'],
  ['styles/viewer/presentation.css', 'cd7aac461bde5110a1df2f7b91d2ebd6e7e3b551349418a30ad5b4fd038976f8'],
  ['styles/loading-primitives.css', '03d7aa3a16f9b3072608c53de0e7e0274d10144c6ea9c62e2c3bd568af802c05'],
] as const;

describe('asset and shared viewer CSS ownership without the Home entry', () => {
  it.each(['PersonalAssetCardPreview.tsx', 'TemplateCardPreview.tsx'])('%s owns the original preview geometry and complete thumbnail states', component => {
    const css = ownedCss(`components/${component}`);
    expect(rule(css, '.community-template-card__preview')).toContain('place-items: center');
    expect(rule(css, '.community-template-card__preview')).toContain('flex: none');
    expect(rule(css, '.community-template-card--image .community-template-card__preview')).toContain('aspect-ratio: auto');
    expect(rule(css, '.community-template-thumb__html-frame')).toContain('transform: scale(0.4)');
    expect(rule(css, '.community-template-thumb__html.is-ready .deck-thumbnail-shadow-host')).toContain('opacity: 1');
    expect(rule(css, '.community-template-thumb__motion.is-active.is-ready .community-template-thumb__motion-frame')).toContain('opacity: 1');
    expect(rule(css, '.community-template-thumb__natural-image.is-loaded .community-template-thumb__image')).toContain('height: auto');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css.indexOf('.plugins-home__media {')).toBeLessThan(css.indexOf('.community-template-thumb__media {'));
    expect(css).not.toContain('.plugins-home__card');
    expect(css).not.toContain('.community-template-view');
  });

  it('the asset library owns the original action positioning, image width and hover appearance', () => {
    const css = ownedCss('components/PersonalAssetLibrary.tsx');
    expect(rule(css, '.collection-card__media-actions.community-template-card__actions')).toContain('bottom: 32px');
    expect(rule(css, '.community-template-card__action')).toContain('background: #fff');
    expect(rule(css, '.community-template-card--image .community-template-card__action')).toContain('min-width: 148px');
    expect(rule(css, '.community-template-card__action:hover:not(:disabled)')).toContain('background: rgb(255 255 255 / 92%)');
  });

  it('the asset library owns the regular grid when NaturalMasonry is disabled for non-image collections', () => {
    const css = ownedCss('components/PersonalAssetLibrary.tsx');
    const grid = rule(css, '.community-template-grid');
    expect(grid).toContain('display: grid');
    expect(grid).toContain('grid-template-columns: repeat(auto-fill, minmax(288px, 1fr))');
    expect(grid).toContain('gap: var(--spacing-20)');
    expect(grid).toContain('align-items: start');
  });

  it('the viewer entry owns deployment controls, result states, disabled links and narrow-screen layout', () => {
    const css = expanded('index.css');
    expect(rule(css, '.deploy-field-grid')).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(rule(css, '.deploy-field-grid.single-field')).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(rule(css, '.cloudflare-domain-grid')).toContain('minmax(180px, 0.85fr) minmax(220px, 1.15fr)');
    expect(rule(css, '.deploy-field-grid label,\n.deploy-field-control')).toContain('flex-direction: column');
    expect(rule(css, '.field-hint')).toContain('font-size: 12px');
    expect(rule(css, '.deploy-error')).toContain('color: var(--red)');
    expect(rule(css, '.deploy-result-block')).toContain('overflow: hidden');
    expect(rule(css, '.deploy-result-block.protected,\n.deploy-result-block.failed')).toContain('border-color:');
    expect(rule(css, '.deploy-result-url')).toContain('overflow-wrap: anywhere');
    expect(rule(css, ".ghost-link.disabled,\n.ghost-link[aria-disabled='true']")).toContain('pointer-events: none');
    const narrow: string[] = [];
    postcss.parse(css).walkAtRules('media', node => {
      if (node.params === '(max-width: 640px)') narrow.push(node.toString());
    });
    expect(rule(narrow.join('\n'), '.deploy-field-grid,\n  .cloudflare-domain-grid')).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(rule(narrow.join('\n'), '.deploy-result-link')).toContain('grid-template-columns: minmax(0, 1fr)');
    const entry = source('index.css');
    expect(entry.indexOf("'./styles/viewer/tools.css'")).toBeLessThan(entry.indexOf("'./styles/viewer/deployment.css'"));
    expect(entry.indexOf("'./styles/viewer/deployment.css'")).toBeLessThan(entry.indexOf("'./styles/viewer/presentation.css'"));
  });

  it('the actual media consumer owns layered image/video, fallback and shimmer keyframes', () => {
    const css = ownedCss('components/asset-library/AssetMediaSurface.tsx');
    expect(rule(css, '.plugins-home__media')).toContain('position: absolute');
    expect(rule(css, '.plugins-home__media-video')).toContain('z-index: 1');
    expect(rule(css, '.plugins-home__media-fallback-glyph')).toContain('font-size: 52px');
    expect(rule(css, '.plugins-home__media-skeleton.is-active')).toContain('plugins-home-shimmer');
    expect(css).toContain('@keyframes plugins-home-shimmer');
  });

  it('the global entry owns loader, icon animation and body-portal presentation at the original composio position', () => {
    const css = expanded('index.css');
    expect(rule(css, '.centered-loader')).toContain('padding: 48px 12px');
    expect(rule(css, '.centered-loader-label')).toContain('letter-spacing: 0.01em');
    expect(rule(css, '.icon-spin')).toContain('animation: icon-spin 0.9s linear infinite');
    expect(css).toContain('@keyframes icon-spin { to { transform: rotate(360deg); } }');
    expect(rule(css, '.present-overlay')).toContain('position: fixed');
    expect(rule(css, '.present-overlay')).toContain('z-index: 1050');
    expect(rule(css, '.present-overlay iframe')).toContain('height: 100%');
    expect(css).toContain('@keyframes present-esc-hint-in-out');
    expect(rule(css, '.present-esc-hint')).toContain('animation: none');
    const entry = source('index.css');
    expect(entry.indexOf("'./styles/viewer/tools.css'")).toBeLessThan(entry.indexOf("'./styles/viewer/presentation.css'"));
    expect(entry.indexOf("'./styles/viewer/presentation.css'")).toBeLessThan(entry.indexOf("'./styles/workspace/question-form.css'"));
    expect(entry.indexOf("'./styles/workspace/question-form.css'")).toBeLessThan(entry.indexOf("'./styles/loading-primitives.css'"));
    expect(entry.indexOf("'./styles/loading-primitives.css'")).toBeLessThan(entry.indexOf("'./styles/viewer/interaction-chrome.css'"));
    expect(entry).not.toContain('composio.css');
    expect(entry).not.toContain('home/index.css');
  });

  it.each(extracts)('%s preserves frozen source bytes', (file, hash) => {
    const body = source(file).split('/* BEGIN FROZEN RULES */\n')[1];
    expect(body).toBeDefined();
    expect(createHash('sha256').update(body).digest('hex')).toBe(hash);
    expect(() => postcss.parse(source(file))).not.toThrow();
  });
});
