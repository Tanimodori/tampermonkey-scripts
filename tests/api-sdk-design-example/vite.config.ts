/// <reference types="node" />
import { resolve } from 'path';
import dts from 'unplugin-dts/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    dts({
      // 公开面只有 `src/`：默认文件清单来自 `tsconfig.json`，它还收着 `test/` 与这一份配置。
      tsconfigPath: 'tsconfig.build.json',
      bundleTypes: true,
      // `main`、`types`、`exports` 在 package.json 里手写维护，不在这里插入。
      insertTypesEntry: false,
    }),
  ],
  // 没有 `vitest.config.ts`：测试与 `vite build` 读的都是这一份。`@/…` 只需要在这一处与 `tsconfig.json` 的
  // `paths` 指向同一个 `src/`。
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  build: {
    // 示例的产物是给人读的：zod 有没有内联，打开 `dist/index.js` 就能看见。
    minify: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rolldownOptions: {
      // zod 作为外部依赖解析，不内联进产物。
      external: ['zod'],
    },
  },
});
