/// <reference types="node" />
import { resolve } from 'path';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    dts({
      // 公开面只有 `src/`，这正是 `tsconfig.app.json` 命名的范围。
      tsconfigPath: 'tsconfig.app.json',
      bundleTypes: true,
      // `main`、`types`、`exports` 在 package.json 里手写维护，不在这里插入。
      insertTypesEntry: false,
    }),
  ],
  // 没有 `vitest.config.ts`：测试与 `vite build` 读的都是这一份。
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  build: {
    // 产物是给人读的：没有需要外置或分块的依赖，单入口单文件。
    minify: false,
    sourcemap: true,
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
  },
});
