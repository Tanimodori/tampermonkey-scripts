/// <reference types="node" />
import { resolve } from 'path';
import userscriptMetadata from 'vite-plugin-userscript-metadata';
import { defineConfig } from 'vitest/config';
import { USERSCRIPT_META } from './src/userscript.meta.ts';

export default defineConfig({
  // 生成物保持可读的缩进 JSON；构建时统一转成紧凑的 JSON.parse，缩进不进 bundle。
  json: {
    stringify: true,
    namedExports: false,
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      name: 'xivanalysisZh',
      formats: ['iife'],
      fileName: () => 'index.js',
    },
    minify: false,
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  plugins: [
    userscriptMetadata({
      meta: USERSCRIPT_META,
      injectPackageJson: true,
    }),
  ],
  test: {
    // 只认单测目录：`test/e2e/` 归 Playwright，文件名同样可能是 `*.spec.ts`。
    include: ['test/unit/**/*.spec.ts', 'test/dom/**/*.spec.ts', 'test/coverage/**/*.spec.ts'],
    // `src/style.ts` 以 `?inline` 导入 CSS，需要让 Vitest 处理样式才能拿到内容。
    css: true,
  },
});
