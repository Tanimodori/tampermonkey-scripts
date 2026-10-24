import { defineConfig } from 'vitest/config';

/** 在线契约专用：只收 live-upstream，不进入 unit 门禁。 */
export default defineConfig({
  test: {
    include: ['test/live-upstream/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
