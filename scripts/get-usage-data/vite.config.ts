/// <reference types="node" />
import { resolve } from 'path';
import Icons from 'unplugin-icons/vite';
import userscriptMetadata from 'vite-plugin-userscript-metadata';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      name: 'getUsageData',
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
    // 图标在构建时从 @iconify-json/mdi 取，以 `compiler: 'raw'` 内联成字符串进产物，运行时零依赖。
    // `autoInstall` 关掉：它会在构建中途调包管理器补装图标集，绕过 rush 的依赖管理。
    Icons({ compiler: 'raw', autoInstall: false }),
    userscriptMetadata({
      meta: {
        name: { default: 'get-usage-data', zh: '大模型用量数据保存' },
        description: {
          default: 'Save usage data from LLM platform pages as JSON files',
          zh: '从大模型服务商网页中保存用量数据',
        },
        namespace: 'http://tanimodori.com/',
        match: 'https://platform.deepseek.com/*',
        include: 'https://platform.deepseek.com/*',
        // 全程只读页面自己的请求：不代发请求，也不用 GM API，故在页面主世界直接覆写 fetch / XHR。
        grant: 'none',
        'run-at': 'document-start',
      },
      injectPackageJson: true,
    }),
  ],
  test: {
    // 按钮、路由监听、下载都摸 DOM；纯函数用例在 happy-dom 下跑同样成立。
    environment: 'happy-dom',
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
