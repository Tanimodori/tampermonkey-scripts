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
      name: 'tenhouPairiKoukeiDisplay',
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
        name: {
          default: '天鳳牌理好形表示',
          zh: '天凤牌理好形表示',
          'zh-CN': '天凤牌理好形表示',
          'zh-TW': '天鳳牌理好形表示',
          en: 'Tenhou-Pairi Kokei display',
        },
        description: {
          default: '天鳳牌理で一向聴の好形率を表示する',
          zh: '在天凤牌理中显示好形率',
          'zh-CN': '在天凤牌理中显示好形率',
          'zh-TW': '在天鳳牌理中顯示好形率',
          en: 'Display Kokei percentage of ii-shan-ten in Tenhou-Pairi',
        },
        namespace: 'http://tanimodori.com/',
        match: ['http://tenhou.net/2/*', 'https://tenhou.net/2/*'],
        include: ['http://tenhou.net/2/*', 'https://tenhou.net/2/*'],
        grant: 'none',
      },
      injectPackageJson: true,
    }),
  ],
});
