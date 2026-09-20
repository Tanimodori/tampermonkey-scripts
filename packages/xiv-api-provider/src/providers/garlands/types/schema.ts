import { z } from 'zod';

/**
 * Zod definitions for the Garland mirror, and the only place zod is mentioned in this provider.
 *
 * Business code imports the inferred types from here with `import type`, so zod stays out of the shipped
 * bundle; the schemas are used by tests, against returned documents. Garland is modelled far more loosely
 * than xivapi on purpose — see the notes below.
 */

/** The locale keys that appear as sub-objects of a document. */
export const garlandSubLocales = ['en', 'ja', 'fr', 'de', 'tc', 'ko'] as const;
export type GarlandSubLocale = (typeof garlandSubLocales)[number];

/**
 * What `search.php?lang=` and the `/db/doc/…/{locale}/…` segment accept.
 *
 * `chs` is the mirror's spelling for the locale that appears at the *top level* of a document: there is no
 * `chs` sub-object, because `name`/`description` already are the requested language.
 */
export const garlandRequestLocales = ['chs', 'ja', 'en', 'de', 'fr'] as const;
export type GarlandRequestLocale = (typeof garlandRequestLocales)[number];

export const garlandNameDescSchema = z.looseObject({ name: z.string(), description: z.string() });
export type GarlandNameDesc = z.infer<typeof garlandNameDescSchema>;

/**
 * The four locales every document carries. `tc` (Traditional Chinese) and `ko` are present on the documents
 * that were checked but optional here: both userscripts' hand-written copies list only four, which is
 * evidence that not every document has six.
 */
const localizedFields = {
  name: z.string(),
  description: z.string(),
  en: garlandNameDescSchema,
  ja: garlandNameDescSchema,
  fr: garlandNameDescSchema,
  de: garlandNameDescSchema,
  tc: garlandNameDescSchema.optional(),
  ko: garlandNameDescSchema.optional(),
};

export const garlandActionSchema = z.looseObject({
  ...localizedFields,
  id: z.number(),
  icon: z.number(),
  patch: z.number().optional(),
  category: z.number().optional(),
  affinity: z.number().optional(),
  lvl: z.number().optional(),
  range: z.number().optional(),
  cast: z.number().optional(),
  recast: z.number().optional(),
  job: z.number().optional(),
  resource: z.unknown().optional(),
  cost: z.unknown().optional(),
  gcd: z.unknown().optional(),
});
export type GarlandAction = z.infer<typeof garlandActionSchema>;

export const garlandStatusSchema = z.looseObject({
  ...localizedFields,
  id: z.number(),
  icon: z.number(),
  patch: z.number().optional(),
  category: z.number().optional(),
  canDispel: z.boolean().optional(),
});
export type GarlandStatus = z.infer<typeof garlandStatusSchema>;

/**
 * An item document.
 *
 * `category` is an `ItemUICategory` row despite the name — the reason the existing userscript has to bridge
 * to a search category at all. `tradeable` appears only on tradeable items, so an absent field means "not
 * tradeable" rather than "unknown", which is the opposite of how an optional usually reads; hence
 * `isGarlandTradeable`.
 */
export const garlandItemSchema = z.looseObject({
  ...localizedFields,
  id: z.number(),
  icon: z.number(),
  patch: z.number().optional(),
  patchCategory: z.number().optional(),
  price: z.number().optional(),
  ilvl: z.number().optional(),
  category: z.number().optional(),
  dyecount: z.number().optional(),
  tradeable: z.number().optional(),
  sell_price: z.number().optional(),
  rarity: z.number().optional(),
  unique: z.unknown().optional(),
  unlistable: z.unknown().optional(),
  stackSize: z.number().optional(),
  attr: z.unknown().optional(),
  attr_hq: z.unknown().optional(),
  quests: z.unknown().optional(),
  loots: z.unknown().optional(),
  craft: z.unknown().optional(),
  supply: z.unknown().optional(),
});
export type GarlandItem = z.infer<typeof garlandItemSchema>;

/** Only the payload key is required; `ingredients` and `partials` restate what `item` already holds. */
export const garlandItemResponseSchema = z.looseObject({ item: garlandItemSchema });
export const garlandActionResponseSchema = z.looseObject({ action: garlandActionSchema });
export const garlandStatusResponseSchema = z.looseObject({ status: garlandStatusSchema });

export type GarlandItemResponse = z.infer<typeof garlandItemResponseSchema>;
export type GarlandActionResponse = z.infer<typeof garlandActionResponseSchema>;
export type GarlandStatusResponse = z.infer<typeof garlandStatusResponseSchema>;

export const garlandDocKinds = ['item', 'action', 'status'] as const;
export type GarlandDocKind = (typeof garlandDocKinds)[number];

/**
 * The compact record a search hit carries.
 *
 * Heterogeneous by design: which keys appear depends on the document kind and sometimes on the individual
 * record, and the same letter changes meaning between them (`c` is an icon on some kinds and an array on
 * others). So only `i` and `n` — id and name, which every kind supplies — are required, and the rest stay
 * `unknown` rather than being guessed at. A caller that wants `obj.g` reads it and checks the type itself.
 */
export const garlandSearchObjSchema = z.looseObject({
  i: z.number(),
  n: z.string(),
  c: z.unknown().optional(),
  j: z.unknown().optional(),
  t: z.unknown().optional(),
  l: z.unknown().optional(),
  r: z.unknown().optional(),
  g: z.unknown().optional(),
  p: z.unknown().optional(),
  f: z.unknown().optional(),
});
export type GarlandSearchObj = z.infer<typeof garlandSearchObjSchema>;

/**
 * A `search.php` hit.
 *
 * `id` is a JSON **string**, not a number. Both userscript packages declare it `number` and
 * `universalis-zh-data/src/index.ts` assigns it straight into `ID: number`, so the value the page renders
 * has been a string all along. `obj.i` carries the same number as a real number and is the one to use.
 */
export const garlandSearchItemSchema = z.looseObject({ type: z.string(), id: z.string(), obj: garlandSearchObjSchema });
export type GarlandSearchItem = z.infer<typeof garlandSearchItemSchema>;

export const garlandSearchResponseSchema = z.array(garlandSearchItemSchema);
