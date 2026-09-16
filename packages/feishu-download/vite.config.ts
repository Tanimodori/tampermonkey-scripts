/// <reference types="node" />
import { resolve } from 'path';
import { defineConfig } from 'vite';
import gfMetadata from './build/gfMetadata.ts';

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
  plugins: [gfMetadata],
});
