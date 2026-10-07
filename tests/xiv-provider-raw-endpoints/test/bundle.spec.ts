import { describe, expect, it } from 'vitest';
import { papaparseRuntime, products, readProduct } from './testUtils/reader.js';

/**
 * The products' composition: what naming raw endpoints, and no verified one, leaves in each of the three
 * bundles. Deciding this from outside the packages is the whole reason this project exists.
 *
 * Both heavyweight libraries ride on a wall a bundler can only drop whole. `xiv-api-provider` and
 * `xiv-garland-provider` partition their `dist/` along zod (`codeSplitting` groups): the schema module
 * (`endpoints/schema.ts`, or `endpoints/<组>/schema.ts`, beside the `verified.ts` that fills the validation
 * slot) carries zod and imports only downward, never back. A consumer that names raw endpoints and no verified
 * one lets its bundler delete that chunk — and zod with it — wholesale instead of having to prove the schema
 * initializers dead. Flatten a provider back into one file and zod comes along silently, which is the failure
 * this check exists to catch: weight, not a broken import.
 *
 * papaparse arrives from the other direction. `xiv-datamine-provider` is partitioned the same way: `parse.js`
 * is the only module that names papaparse, and `core.js` reaches it only through the one operation
 * (`readSheet`) that parses. So a build that names `fetchSheetCsv` and nothing else never reaches the
 * `parse.js` chunk, and the library goes the way of the schema chunks. The chunk is the droppable unit; a
 * single file is not.
 *
 * `treeshake.moduleSideEffects` is not a substitute: it only decides whether an unused whole module may be
 * removed, while a module's statements count as side-effect-free only while none of its exports are used. A
 * flat artifact defines a used export, so its schema initializers — and zod — stay whatever the consumer sets.
 * See <https://rolldown.rs/in-depth/dead-code-elimination#marking-entire-modules-as-side-effect-free>.
 *
 * The identifiers matter, and so do the words that are deliberately NOT used. `minify: false` keeps the source
 * comments, and the providers' comments say "zod" and "papaparse" in prose — the raw modules' own comments do.
 * A bare-word check would therefore fail even while the wall holds, so the negative side is spelled with
 * identifiers only: `_zod` (the property every zod instance hangs off) and the schema module's own constant on
 * the zod side; `papaparse_min` on the papaparse side (the suffix rolldown gives papaparse's CJS wrapper,
 * `var <prefix>_papaparse_min = __toESM(__commonJSMin(…)` — the prefix itself has moved between releases, see
 * `testUtils/reader.ts`, and only a product that really pulled the library in has the wrapper at all).
 */
describe('the products', () => {
  for (const product of products) {
    describe(product.file, () => {
      it('carries the raw endpoint its entry named, and neither a schema engine nor a CSV parser', () => {
        const bundle = readProduct(product);

        // Positive control first: the named raw endpoint's identifier really is in the product, so a build
        // that resolved nothing cannot pass the negative checks below.
        for (const name of product.names) expect(bundle, `the entry named ${name}, but the product does not contain it`).toContain(name);

        // Negative, zod side. `_zod` is the wide check; the provider's own schema constant is the narrow one,
        // and each product names the constant of the provider it was built from.
        expect(bundle, 'a zod runtime trace reached the product').not.toContain('_zod');
        if (product.schemaConstant !== null)
          expect(bundle, `the schema module's own constant ${product.schemaConstant} reached the product`).not.toContain(product.schemaConstant);

        // Negative, papaparse side.
        expect(bundle, 'papaparse was dragged into the product').not.toContain(papaparseRuntime);
      });
    });
  }
});
