import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts'],
      reporter: ['text-summary', 'json-summary'],
      // 参赛交付门槛：新增代码单测覆盖率 ≥60%。
      thresholds: { lines: 60, statements: 60 },
    },
  },
});
