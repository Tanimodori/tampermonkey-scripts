/// <reference types="node" />
import { resolve } from 'path';
import { defineConfig } from 'vite';

/**
 * A measuring instrument, not an app: one library build with three entries, one per provider, each naming only
 * that provider's raw endpoints. The products are `dist/xivapi.js`, `dist/datamine.js` and `dist/garland.js`,
 * and `test/bundle.spec.ts` reads them back as text.
 *
 * The three providers already partition their `dist/` along their one heavyweight dependency — the zod wall in
 * `xiv-api-provider` and `xiv-garland-provider` (`endpoints/schema.ts` / `endpoints/<组>/schema.ts` beside the
 * `verified.ts` that fills the validation slot), the papaparse wall in `xiv-datamine-provider`
 * (`utils/parse.ts`). The question this build answers is whether that partition survives into a real
 * consumer's output: the entries' bundler may delete a chunk nobody named only while the chunk is droppable as
 * a whole. Flatten a provider into one file and the wall's dependency rides along in the very module the named
 * endpoint lives in, so naming a raw endpoint is enough to bring zod or papaparse into the product.
 *
 * `minify: false` is load-bearing, not aesthetics: the negative assertions are identifier checks, and comments
 * that say the word "zod" or "papaparse" in prose are expected to survive. Minifying would rename away both
 * the identifiers being looked for and the evidence that the wall held.
 */
export default defineConfig({
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    lib: {
      // Three entries, three products — one per provider, so each product can be judged on its own wall without
      // the others' chunks in the way.
      entry: {
        xivapi: resolve(import.meta.dirname, 'src', 'xivapi.ts'),
        datamine: resolve(import.meta.dirname, 'src', 'datamine.ts'),
        garland: resolve(import.meta.dirname, 'src', 'garland.ts'),
      },
      formats: ['es'],
    },
    rolldownOptions: {
      /**
       * `api-sdk-framework` is value-imported by `xiv-datamine-provider`'s and `xiv-garland-provider`'s client
       * layer (`createCall`, `ApiError`), and both providers already leave it external; here it is external for
       * a second reason. Both of those entries reach it, so a bundled copy would be a module shared between two
       * entries and rolldown would hoist it into a fourth chunk — `dist/` would stop being exactly the three
       * products this project reads. External keeps each product self-contained.
       *
       * `zod` and `papaparse` are deliberately NOT external, and are deliberately absent from `package.json`.
       * They are the walls being measured: a product may mention them only if it actually pulled them in, and
       * then the negative assertions in `test/bundle.spec.ts` fail on the runtime traces (`_zod`, the schema
       * module's own constant, `papaparse_min`). Leaving them non-external is what makes the failure visible in
       * the product rather than hidden behind an import specifier.
       */
      external: ['api-sdk-framework'],
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
      },
    },
  },
});
