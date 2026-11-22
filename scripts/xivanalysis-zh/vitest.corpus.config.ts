import { defineConfig } from 'vitest/config';

/**
 * 独立响应采集：只跑 test/corpus，不进入 test:unit。
 * 放在独立的 Vitest 配置里，是为了让采集脚本能直接 import 生产 TS（Vite 负责 JSON import）。
 */
export default defineConfig({
  test: {
    include: ['test/corpus/**/*.spec.ts'],
    testTimeout: 4_000_000,
    hookTimeout: 4_000_000,
    fileParallelism: false,
    pool: 'forks',
  },
});
