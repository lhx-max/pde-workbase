// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../src/i18n';
import { HandoffButton, HtmlViewerAdapterProvider } from '../src/components/html-viewer/adapters';

afterEach(cleanup);
for (const [locale, message] of [
  ['zh-CN', '当前宿主未配置交付目标。'],
  ['en', 'The host has not configured a hand-off destination.'],
] as const) {
  it(`localizes the genuinely unavailable host action in ${locale}`, async () => {
    render(<I18nProvider initial={locale}><HandoffButton projectId="local-project" /></I18nProvider>);
    fireEvent.click(screen.getByRole('button'));
    expect((await screen.findByRole('alert')).textContent).toBe(message);
    await waitFor(() => expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false));
  });
}
it('preserves a configured host error instead of reporting missing configuration', async () => {
  const handoff = vi.fn(async () => { throw new Error('Host rejected this destination'); });
  render(<I18nProvider initial="zh-CN"><HtmlViewerAdapterProvider adapters={{ handoff }}><HandoffButton projectId="local-project" /></HtmlViewerAdapterProvider></I18nProvider>);
  fireEvent.click(screen.getByRole('button'));
  expect((await screen.findByRole('alert')).textContent).toBe('Host rejected this destination');
  expect(handoff).toHaveBeenCalledWith({ projectId: 'local-project' });
});
it('retains successful configured handoff without an unavailable message', async () => {
  const handoff = vi.fn(async () => {});
  render(<I18nProvider initial="zh-CN"><HtmlViewerAdapterProvider adapters={{ handoff }}><HandoffButton projectId="local-project" /></HtmlViewerAdapterProvider></I18nProvider>);
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(handoff).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false));
  expect(screen.queryByRole('alert')).toBeNull();
});
