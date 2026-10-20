import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./lib', import.meta.url)) } },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 45_000, hookTimeout: 180_000, fileParallelism: false },
});
