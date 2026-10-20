// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider, useI18n } from '../src/i18n';
import { requestJson, WorkspaceApiError } from '../src/providers/registry';
import { createHttpAssetLibrary, PersonalAssetRequestError } from '../src/providers/asset-library';
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); vi.unstubAllGlobals(); });
function denyRequests() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Access denied by adapter' } }), { status: 403 })));
}
it('uses explicit English application locale with empty storage for both API adapters', async () => {
  localStorage.clear(); denyRequests();
  render(createElement(I18nProvider, { initial: 'en', children: null }));
  for (const operation of [() => requestJson('/api/projects'), () => createHttpAssetLibrary().info()]) {
    const error = await operation().catch(value => value);
    expect(error.message).toBe('Access denied by adapter');
    expect(error.status).toBe(403);
    expect(error.diagnosticMessage).toBe('Access denied by adapter');
  }
  expect(localStorage.getItem('bezier:locale')).toBeNull();
});
it('uses an explicit language change even when persistence is denied', async () => {
  localStorage.clear(); denyRequests();
  function Switcher() { const { t, setLocale } = useI18n(); return createElement('button', { onClick: () => setLocale('en') }, t('common.save')); }
  render(createElement(I18nProvider, { children: createElement(Switcher) }));
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage denied'); });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  const error = await requestJson('/api/projects').catch(value => value);
  expect(error.message).toBe('Access denied by adapter');
  expect(error.code).toBe('FORBIDDEN');
});
it('returns to the Chinese default after the application provider unmounts', async () => {
  localStorage.clear(); denyRequests();
  const view = render(createElement(I18nProvider, { initial: 'en', children: null }));
  expect((await requestJson('/api/projects').catch(value => value)).message).toBe('Access denied by adapter');
  view.unmount();
  expect((await requestJson('/api/projects').catch(value => value)).message).toBe('你没有权限执行此操作。');
});
it('shows Chinese workspace HTTP failures without losing protocol codes or diagnostics', async () => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Access denied by adapter' } }), { status: 403 })));
  const error = await requestJson('/api/projects').catch(value => value);
  expect(error).toBeInstanceOf(WorkspaceApiError);
  expect(error.status).toBe(403);
  expect(error.code).toBe('FORBIDDEN');
  expect(error.message).toMatch(/[\u4e00-\u9fff]/);
  expect(error.diagnosticMessage).toBe('Access denied by adapter');
});
it('shows Chinese library failures and retains the original diagnostic', async () => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'External library not connected' } }), { status: 503 })));
  const error = await createHttpAssetLibrary().info().catch(value => value);
  expect(error).toBeInstanceOf(PersonalAssetRequestError);
  expect(error.status).toBe(503);
  expect(error.message).toMatch(/[\u4e00-\u9fff]/);
  expect(error.diagnosticMessage).toBe('External library not connected');
});
