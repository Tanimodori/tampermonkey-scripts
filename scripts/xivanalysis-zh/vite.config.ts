/// <reference types="node" />
import { resolve } from 'path';
import userscriptMetadata from 'vite-plugin-userscript-metadata';
import { defineConfig } from 'vitest/config';

export default defineConfig({
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
      meta: {
        name: { default: 'xivanalysis-zh', zh: 'xivanalysis 中文补全' },
        description: {
          default: 'Fill in the missing Chinese translations for xivanalysis',
          zh: '为 xivanalysis 填补缺失的中文翻译',
        },
        namespace: 'http://tanimodori.com/',
        match: 'https://xivanalysis.com/*',
        include: 'https://xivanalysis.com/*',
        // 截获并改写宿主页 fetch(unsafeWindow)。CN 读走原生 fetch(国服回 ACAO:*);
        // 仅 garlands search.php 兜底无 CORS 头,须经 GM → 保留 GM_xmlhttpRequest + @connect。
        grant: ['GM_xmlhttpRequest', 'unsafeWindow'],
        connect: ['www.garlandtools.cn'],
        'run-at': 'document-start',
      },
      injectPackageJson: true,
    }),
  ],
  test: {
    // `test/e2e/` 归 playwright，文件名同样是 `*.spec.ts`，不排掉 vitest 会把它当自己的用例跑。
    exclude: ['test/e2e/**', '**/node_modules/**', '**/dist/**'],
  },
});
