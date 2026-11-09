import { defineConfig } from '@playwright/test';
import type { WorkerFixtures } from './lib/playwright/suite.js';
import { T } from './lib/timeouts.js';

export default defineConfig<{}, WorkerFixtures>({
  testDir: './ui',
  timeout: T.xlong,
  expect: { timeout: T.medium },
  workers: Number(process.env.CANVAS_E2E_WORKERS ?? 1),
  fullyParallel: true,
  retries: 0,
  outputDir: './test-results',
  reporter: [['list'], ['html', { outputFolder: './playwright-report', open: 'never' }]],
  use: { viewport: { width: 1440, height: 960 }, locale: 'en-US', actionTimeout: T.medium, navigationTimeout: T.long, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'web', testIgnore: '*native*.test.ts', use: { runtimeTarget: 'web', ...(process.env.CANVAS_E2E_BROWSER_CHANNEL ? { channel: process.env.CANVAS_E2E_BROWSER_CHANNEL } : {}) } },
    // Native resource requests carry ephemeral grant headers: keep them out of traces.
    { name: 'desktop', testMatch: '*native*.test.ts', use: { runtimeTarget: 'desktop', trace: 'off' } },
  ],
});
