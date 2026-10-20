import { test as base, expect, chromium, type Page } from '@playwright/test';
import { startToolsDev, type RuntimeTarget, type ToolsDevRuntime } from '../tools-dev/runtime.js';
import { T } from '../timeouts.js';

export type WorkerFixtures = { runtimeTarget: RuntimeTarget; runtime: ToolsDevRuntime; runtimeEvidence: { failed: boolean } };
type Fixtures = { nativePage: Page; runtimeAttachments: void };
export const test = base.extend<Fixtures, WorkerFixtures>({
  runtimeTarget: ['web', { option: true, scope: 'worker' }],
  runtimeEvidence: [async ({}, use) => { await use({ failed: false }); }, { scope: 'worker' }],
  runtime: [async ({ runtimeTarget, runtimeEvidence }, use, workerInfo) => {
    const runtime = await startToolsDev({ target: runtimeTarget, label: `${runtimeTarget}-worker-${workerInfo.workerIndex}` });
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
