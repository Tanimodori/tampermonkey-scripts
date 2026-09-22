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
      name: 'universalisZhData',
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
        name: { default: 'universalis-zh-data', zh: 'Universalis 中文数据补全' },
        description: {
          default: 'Universalis Chinese data localization script',
          zh: 'Universalis 中文数据补全脚本',
        },
        namespace: 'http://tanimodori.com/',
        match: 'https://universalis.app/*',
        include: 'https://universalis.app/*',
        grant: 'none',
        'run-at': 'document-start',
      },
      injectPackageJson: true,
    }),
  ],
});
