/// <reference types="node" />
import { resolve } from 'path';
import { defineConfig } from 'vite';
import userscriptMetadata from 'vite-plugin-userscript-metadata';

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
    alias: { '@': resolve(import.meta.dirname, 'src') },
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
        grant: 'none',
        'run-at': 'document-start',
      },
      injectPackageJson: true,
    }),
  ],
});
