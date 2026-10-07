import { readFileSync } from 'node:fs';

/**
 * A product of the measuring build, and what naming only raw endpoints is supposed to leave in it.
 *
 * The spec reads `dist/` rather than importing it: the thing under test is the built text, and importing a
 * product would first require it to be runnable — it keeps `api-sdk-framework` external, and its functions are
 * never meant to run. Text is also where the comments that survive `minify: false` live, and seeing past those
 * comments is half of what the negatives are for.
 */
export interface Product {
  /** The product's file name under `dist/`. */
  readonly file: string;
  /**
   * Identifiers the entry named. These are the positive control: without them a product that resolved nothing
   * would sail through every negative assertion below.
   */
  readonly names: readonly string[];
  /**
   * The provider's own zod-schema constant, where the provider has a zod wall — `null` where it has none.
   * The narrow half of the zod check; `_zod` is the wide half.
   */
  readonly schemaConstant: string | null;
}

/** The three products, in the order the entries are declared in `vite.config.ts`. */
export const products: readonly Product[] = [
  { file: 'xivapi.js', names: ['readRowRaw'], schemaConstant: 'rowResultSchema' },
  { file: 'datamine.js', names: ['fetchSheetCsv'], schemaConstant: null },
  { file: 'garland.js', names: ['readItemRaw', 'garlandSearchRaw'], schemaConstant: 'garlandNameDescSchema' },
];

/**
 * The identifier rolldown gives papaparse's CJS wrapper, whose UMD build becomes `…_papaparse_min`. The prefix
 * rolldown picks has moved between releases — an older vite emitted `require_papaparse_min`, the one behind
 * this repo's vite emits `import_papaparse_min` — so the check names the `papaparse_min` suffix both share
 * (probe-verified to be present only when the library is really in the bundle, and absent from the providers'
 * retained prose, which says "papaparse" but never "papaparse_min").
 */
export const papaparseRuntime = 'papaparse_min';

/** Read one product as text, black-box: nothing here reaches the `src/` it was built from. */
export const readProduct = (product: Product): string => readFileSync(new URL(`../../dist/${product.file}`, import.meta.url), 'utf8');
