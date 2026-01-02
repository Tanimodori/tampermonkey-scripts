/// <reference types="node" />
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import gfMetadata from './build/gfMetadata';

export default defineConfig({
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'tenhouPairiKoukeiDisplay',
      formats: ['iife'],
      fileName: () => 'index.js',
    },
    minify: false,
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  plugins: [gfMetadata],
});
