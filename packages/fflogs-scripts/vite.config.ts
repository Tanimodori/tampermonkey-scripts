/// <reference types="node" />
import { resolve } from 'path';
import glob from 'fast-glob';
import { defineConfig, type UserConfig } from 'vite';
import stripComments from 'vite-plugin-strip-comments';

export default defineConfig(async (): Promise<UserConfig> => {
  const entry = await glob('src/entry/**/*.ts');
  return {
    build: {
      outDir: resolve(__dirname, 'dist'),
      emptyOutDir: true,
      minify: true,
      lib: {
        entry,
        formats: ['es'],
        fileName: (format, name) => `${name}.js`,
      },
      rollupOptions: {
        output: {
          preserveModules: true,
          preserveModulesRoot: 'src/entry',
        },
      },
    },
    esbuild: {
      // https://github.com/vitejs/vite/pull/18737
      minifyWhitespace: true,
    },
    resolve: {
      alias: { '@': resolve(__dirname, 'src') },
    },
    plugins: [stripComments({ type: 'none' })],
  };
});

