import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    maxWorkers: 2,
    server: {
      deps: {
        // This React/CSS package targets browser bundlers, not native Node ESM.
        // Let Vite resolve its extensionless imports and CSS modules in tests.
        inline: ['@doc/surface'],
      },
    },
  },
});
