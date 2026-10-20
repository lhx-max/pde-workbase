import { test as base, expect, chromium, type Page } from '@playwright/test';
import { startToolsDev, type RuntimeTarget, type ToolsDevRuntime } from '../tools-dev/runtime.js';
import { T } from '../timeouts.js';
import path from 'node:path';
import { stageCaptureExtension } from '../tools-dev/extension-fixture.js';

export type WorkerFixtures = { runtimeTarget: RuntimeTarget; mfFixture: boolean; runtime: ToolsDevRuntime; runtimeEvidence: { failed: boolean } };
type Fixtures = { nativePage: Page; externalExtension: { page: Page; id: string }; runtimeAttachments: void };
export const test = base.extend<Fixtures, WorkerFixtures>({
  runtimeTarget: ['web', { option: true, scope: 'worker' }],
  mfFixture: [false, { option: true, scope: 'worker' }],
  runtimeEvidence: [async ({}, use) => { await use({ failed: false }); }, { scope: 'worker' }],
  runtime: [async ({ runtimeTarget, runtimeEvidence, mfFixture }, use, workerInfo) => {
    const runtime = await startToolsDev({ target: runtimeTarget, mfFixture, label: `${runtimeTarget}-worker-${workerInfo.workerIndex}` });
    try { await use(runtime); } finally { await runtime.dispose({ preserve: runtimeEvidence.failed }); }
  }, { scope: 'worker', timeout: T.xlong + T.long }],
  baseURL: async ({ runtime }, use) => { await use(runtime.webUrl); },
  nativePage: async ({ runtime }, use, testInfo) => {
    if (runtime.target !== 'desktop') throw new Error('nativePage requires the isolated desktop tools-dev project');
    const browser = await chromium.connectOverCDP(runtime.inspectUrl, { timeout: T.long });
    try {
      const context = browser.contexts()[0];
      if (!context) throw new Error('Electron did not expose an application browser context');
      const page = context.pages().find(page => new URL(page.url()).origin === runtime.webUrl);
      if (!page) throw new Error('Electron application page was not found at the reported web URL');
      page.setDefaultTimeout(T.medium);
      page.setDefaultNavigationTimeout(T.long);
      await use(page);
      if (testInfo.status !== testInfo.expectedStatus) {
        const path = testInfo.outputPath('native-failure.png');
        try {
          await page.screenshot({ path, fullPage: true });
          await testInfo.attach('native-failure', { path, contentType: 'image/png' });
        } catch { /* The native process may itself be the failure. Runtime logs remain available. */ }
      }
    } finally { await browser.close(); }
  },
  externalExtension: async ({ runtime }, use, testInfo) => {
    if (runtime.target !== 'desktop') throw new Error('External capture requires the owned native application');
    const staged = await stageCaptureExtension(runtime);
    const executablePath = process.env.CANVAS_E2E_EXTENSION_EXECUTABLE;
    if (executablePath && !path.isAbsolute(executablePath)) throw new Error('Extension test browser path must be absolute');
    const context = await chromium.launchPersistentContext(staged.profile, {
      channel: 'chromium', ...(executablePath ? { executablePath } : {}), headless: true,
      locale: 'en-US', viewport: { width: 1440, height: 960 },
      args: [`--disable-extensions-except=${staged.extension}`, `--load-extension=${staged.extension}`],
    });
    try {
      const page = context.pages()[0] ?? await context.newPage();
      page.setDefaultTimeout(T.medium); page.setDefaultNavigationTimeout(T.long);
      await use({ page, id: staged.id });
      if (testInfo.status !== testInfo.expectedStatus) {
        const image = testInfo.outputPath('external-extension-failure.png');
        await page.screenshot({ path: image });
        await testInfo.attach('external-extension-failure', { path: image, contentType: 'image/png' });
      }
    } finally { await context.close(); }
  },
  runtimeAttachments: [async ({ runtime, runtimeEvidence }, use, testInfo) => {
    await use();
    if (testInfo.status !== testInfo.expectedStatus) {
      runtimeEvidence.failed = true;
      await testInfo.attach('tools-dev-runtime.log', { body: await runtime.logs(), contentType: 'text/plain' });
      await testInfo.attach('preserved-runtime.json', { body: JSON.stringify({ root: runtime.root, dataRoot: runtime.dataRoot, webUrl: runtime.webUrl, serverUrl: runtime.serverUrl }), contentType: 'application/json' });
    }
  }, { auto: true }],
});
export { expect };
