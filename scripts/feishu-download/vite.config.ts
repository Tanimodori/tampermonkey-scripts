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
      name: 'feishuDownload',
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
        name: { default: 'feishu-download', zh: '飞书资源下载' },
        description: {
          default: 'Download audio and image resources from Feishu pages',
          zh: '在飞书页面中下载音频和图片资源',
        },
        namespace: 'http://tanimodori.com/',
        match: ['https://*.feishu.cn/*', 'https://*.larksuite.com/*'],
        include: ['https://*.feishu.cn/*', 'https://*.larksuite.com/*'],
        grant: 'none',
        'run-at': 'document-idle',
      },
      injectPackageJson: true,
    }),
  ],
});
