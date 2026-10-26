// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppTabSurface } from '../src/app-surfaces';
import { BROWSER_APP_API_PREFIX, browserAppResourceUrl } from '../src/app-surfaces/browser-transport';

const mocks = vi.hoisted(() => ({ surface: undefined as unknown as Record<string, unknown> }));
vi.mock('@ks-designai/browser-surface', () => ({
  CollectorAppSurface: (props: Record<string, unknown>) => { mocks.surface = props; return <div data-testid="browser-app-surface" />; },
}));
// The sketch surface pulls browser-bundler JSON imports vitest cannot load;
// these cases only exercise the browser branch anyway.
vi.mock('@sketch/surface', () => ({
  I18nProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SketchEditorPane: () => null,
  serializeExcalidrawSketchScene: () => '',
}));

afterEach(() => { cleanup(); mocks.surface = undefined as unknown as Record<string, unknown>; });

const app = { appId: 'browser', name: '浏览器', endpoint: 'http://browser/api/apps/browser' };

describe('browser app tab surface', () => {
  it('mounts the package surface with the persisted instanceId — never an iframe', () => {
    const view = render(<AppTabSurface tab={{ id: 'app:browser:b-1', appId: 'browser', target: 'b-1', label: '浏览器' }} app={app} />);
    expect(mocks.surface?.instanceId).toBe('b-1');
    expect(view.container.querySelector('iframe')).toBeNull();
    expect(view.container.querySelector('[data-testid="browser-app-surface"]')).not.toBeNull();
  });
  it('points the component transport at the same-origin browser proxy, not canvas', () => {
    render(<AppTabSurface tab={{ id: 'app:browser:b-1', appId: 'browser', target: 'b-1', label: '浏览器' }} app={app} />);
    const transport = mocks.surface?.transport as { baseUrl: string; resourceUrl: (url: string) => string; fetch: typeof fetch };
    expect(transport.baseUrl).toBe(BROWSER_APP_API_PREFIX);
    expect(transport.baseUrl).toBe('/api/browser-app');
    expect(transport.fetch).toBeTypeOf('function');
    expect(transport.resourceUrl('/api/projects/p/raw/dir/a.png?v=1')).toBe('/api/browser-app/api/projects/p/raw/dir/a.png?v=1');
    expect(transport.resourceUrl('/api/asset-library/a1/content')).toBe('/api/browser-app/api/asset-library/a1/content');
  });
  it('rebinds only controlled (relative/same-origin) browser API URLs onto the proxy', () => {
    const sameOrigin = `${location.origin}/api/projects/p/raw/a.png`;
    expect(browserAppResourceUrl(sameOrigin)).toBe('/api/browser-app/api/projects/p/raw/a.png');
    expect(browserAppResourceUrl('/api/browser-app/api/projects/p/x')).toBe('/api/browser-app/api/projects/p/x');
    // An external origin with a lookalike API path is never hijacked.
    expect(browserAppResourceUrl('http://127.0.0.1:17620/api/projects/p/raw/a.png')).toBe('http://127.0.0.1:17620/api/projects/p/raw/a.png');
    expect(browserAppResourceUrl('http://127.0.0.1:17460/api/projects/p/raw/a.png')).toBe('http://127.0.0.1:17460/api/projects/p/raw/a.png');
    expect(browserAppResourceUrl('https://cdn.example/image.png')).toBe('https://cdn.example/image.png');
    expect(browserAppResourceUrl('not a url')).toBe('not a url');
  });
  it('lets the collector manage recoverable errors without a permanent host error overlay', () => {
    render(<AppTabSurface tab={{ id: 'app:browser:b-1', appId: 'browser', target: 'b-1', label: '浏览器' }} app={app} />);
    expect(mocks.surface?.onError).toBeUndefined();
    expect(document.querySelector('[data-testid="browser-app-surface"]')).not.toBeNull();
  });
  it('shows the preparing state while the instance is still being created', () => {
    const view = render(<AppTabSurface tab={{ id: 'app:browser:pending:x', appId: 'browser', label: '浏览器' }} app={app} />);
    expect(mocks.surface).toBeUndefined();
    expect(view.container.textContent).toContain('正在准备浏览器');
  });
});
