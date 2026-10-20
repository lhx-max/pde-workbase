// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { detectInitialLocale, I18nProvider, tActive, useI18n } from '../src/i18n';
vi.mock('@bezier/host', () => ({ getBezierHost: () => ({ client: { osLocale: 'en-US' }, ui: { setLocale: vi.fn() } }) }));
function SaveButton() { const { t } = useI18n(); return <button>{t('common.save')}</button>; }
beforeEach(() => { localStorage.clear(); vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']); });
afterEach(() => { vi.unstubAllGlobals(); cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
describe('independent workspace Chinese default', () => {
  it('uses Chinese even on English browsers and desktop hosts', () => { expect(detectInitialLocale()).toBe('zh-CN'); expect(tActive('common.save')).toBe('保存'); });
  it('does not retain an old automatic English preference', () => { localStorage.setItem('bezier:locale', 'en'); expect(detectInitialLocale()).toBe('zh-CN'); });
  it('preserves a deliberate supported language choice', () => { localStorage.setItem('bezier:locale', 'en'); localStorage.setItem('bezier:locale-source', 'manual'); expect(detectInitialLocale()).toBe('en'); });
  it('fails back to Chinese when browser storage cannot be read', () => { vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage denied'); }); expect(detectInitialLocale()).toBe('zh-CN'); });
  it('uses Chinese on the non-browser path', () => { vi.stubGlobal('window', undefined); expect(detectInitialLocale()).toBe('zh-CN'); });
  it('renders Chinese and declares the document language without a locale prop', () => { render(<I18nProvider><SaveButton /></I18nProvider>); expect(screen.getByRole('button', { name: '保存' })).toBeTruthy(); expect(document.documentElement.lang).toBe('zh-CN'); });
  it('does not leak English from components without a provider', () => { render(<SaveButton />); expect(screen.getByRole('button', { name: '保存' })).toBeTruthy(); });
  it('retains explicit English embedding support', () => { render(<I18nProvider initial="en"><SaveButton /></I18nProvider>); expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy(); });
});
