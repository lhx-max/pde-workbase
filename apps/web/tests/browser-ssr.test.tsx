import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DesignBrowserPanel } from '../src/components/DesignBrowserPanel';
import { BrowserCollectorPanel } from '../src/components/BrowserCollectorPanel';

/** Server rendering safety, not hydration/native capability or visual parity. */
describe('browser server rendering', () => {
  it('renders the original reference start surface without window/document or a native bridge', () => {
    expect(typeof window).toBe('undefined');
    const html = renderToString(createElement(DesignBrowserPanel, { projectId: 'ssr-project', onOpenFile() {}, onRefreshFiles() {} }));
    expect(html).toContain('design-browser');
    expect(html).toContain('db-chrome');
    expect(html).not.toContain('<webview');
  });
  it('honestly renders the non-native collector limitation', () => {
    const html = renderToString(createElement(BrowserCollectorPanel, { projectId: 'ssr-project', files: [], onRefreshFiles() {} }));
    expect(html).not.toContain('<webview');
    expect(html).not.toContain('data-testid="browser-collector"');
    expect(html).toContain('<p>');
  });
});
