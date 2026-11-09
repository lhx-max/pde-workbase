import { defineConfig } from 'vitest/config';
import webConfig from '../vitest.config.ts';

// Keep browser-package transforms identical to the normal web test entrypoint.
export default defineConfig({
  ...webConfig,
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    ...webConfig.test,
    include: ['tests/asset-library-*.test.{ts,tsx}'],
    environment: 'jsdom',
  },
});
