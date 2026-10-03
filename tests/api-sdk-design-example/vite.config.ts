/// <reference types="node" />
import { resolve } from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 本包不构建：`dist/` 不是它的产物，这一份配置只被 vitest 读——没有 `vitest.config.ts`，它读的就是这里。
  // `@/…` 因此只需要在这一处与 `tsconfig.json` 的 `paths` 指向同一个 `src/`。
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
});
