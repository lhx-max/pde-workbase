import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Browser-owned focused runner; mirrors the Next @/ source alias for SSR tests. */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('..', import.meta.url)) } },
  oxc: { jsx: { runtime: 'automatic' } },
  test: { include: ['tests/browser-*.test.{ts,tsx}'], environment: 'node' },
});
