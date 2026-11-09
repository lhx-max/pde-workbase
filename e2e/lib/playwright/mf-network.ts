import type { Page, TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { MF_FIXTURE_UI_HOST } from '../tools-dev/mf-fixture.js';

/** Intercept before navigation: real SDK assets may attempt telemetry/CDN calls; never leave loopback. */
export async function guardMfBrowserNetwork(page: Page) {
  const blocked: string[] = [], sdkRequests: string[] = [], errors: string[] = [], consoleErrors: string[] = [];
  const ssoHealthRequests: string[] = [];
  const sdkFailures: Array<{ url: string; method: string; status: number }> = [];
  const httpFailures: Array<{ url: string; method: string; status: number }> = [];
  const isSdkApi = (value: string) => /\/api\/(kpandora|v1\/myknowledge|myskill)(\/|$)/.test(new URL(value).pathname);
  const loopback = (value: string) => {
    const url = new URL(value);
    return ['127.0.0.1', 'localhost', '[::1]', MF_FIXTURE_UI_HOST].includes(url.hostname);
  };
  await page.context().route('**/*', route => {
    const url = route.request().url();
    if (!/^https?:/.test(url)) return route.continue();
    if (new URL(url).pathname === '/sso-health') ssoHealthRequests.push(url);
    if (!loopback(url)) { blocked.push(url); return route.abort('blockedbyclient'); }
    if (isSdkApi(url)) sdkRequests.push(url);
    return route.continue();
  });
  await page.context().routeWebSocket('**/*', socket => {
    if (!loopback(socket.url())) { blocked.push(socket.url()); socket.close({ code: 1008, reason: 'E2E loopback only' }); return; }
    socket.connectToServer();
  });
  page.on('response', response => {
    if (response.status() < 400) return;
    const failure = { url: response.url(), method: response.request().method(), status: response.status() };
    httpFailures.push(failure);
    if (isSdkApi(response.url())) sdkFailures.push(failure);
  });
  page.on('pageerror', error => errors.push(error.message));
  // Keep CSP-denial console evidence separate from uncaught runtime exceptions;
  // never erase either. Tests still fail on every actual pageerror.
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  return { blocked, sdkRequests, ssoHealthRequests, sdkFailures, httpFailures, errors, consoleErrors, async attach(info: TestInfo) {
    const path = info.outputPath('mf-browser-network.json');
    await writeFile(path, JSON.stringify({ blocked, sdkRequests, ssoHealthRequests, sdkFailures, httpFailures, errors, consoleErrors }, null, 2));
    await info.attach('mf-browser-network.json', { path, contentType: 'application/json' });
  } };
}
