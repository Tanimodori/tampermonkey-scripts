import { z } from 'zod';

/**
 * Zod definitions for the xivapi provider, and the only place zod is mentioned in it.
 *
 * Everything here is a **type import** for business code: `import type { RowResponse } from './types/schema.ts'`
 * brings the shape without bringing zod. The schemas themselves are used by tests, which validate
 * *returned* values against them — that is where a shape change gets caught. Request parameters are not
 * validated at runtime: a caller passing a bad sheet name is answered by the API's own 404, and re-checking
 * locally would only duplicate that in the bundle.
 */

/** An icon cell. The `.tex` paths are game-internal; `/asset` takes `path`. */
export const iconFieldSchema = z.looseObject({ id: z.number(), path: z.string(), path_hr1: z.string() });
export type IconField = z.infer<typeof iconFieldSchema>;

/**
 * A link to a row of another sheet, expanded inline.
 *
 * `fields` stays `unknown`: the API nests arbitrarily deep (asking for `Item.ItemSearchCategory` pulls the
 * whole `ClassJob` row with it) and nothing reads that deep through a typed path.
 */
export const sheetLinkSchema = z.looseObject({ value: z.number(), sheet: z.string(), row_id: z.number(), fields: z.unknown() });
export type SheetLink = z.infer<typeof sheetLinkSchema>;

/**
 * Field values keyed by the names asked for in `fields=`.
 *
 * Loose by necessity: `fields=` decides which keys come back, so an unmodelled column is data this
 * package simply does not describe rather than a malformed response.
 */
export const fieldsSchema = z.looseObject({});
export type Fields = z.infer<typeof fieldsSchema>;

/** One row, as `/sheet/{sheet}` lists them and `/sheet/{sheet}/{row}` returns one of. */
export const rowResultSchema = z.looseObject({
  row_id: z.number(),
  subrow_id: z.number().nullish(),
  fields: fieldsSchema,
  transient: fieldsSchema.optional(),
});
export type RowResult = z.infer<typeof rowResultSchema>;

/** A search hit: a row plus which sheet it came from and how well it matched. */
export const searchResultSchema = z.looseObject({
  score: z.number(),
  sheet: z.string(),
  row_id: z.number(),
  subrow_id: z.number().nullish(),
  fields: fieldsSchema,
  transient: fieldsSchema.optional(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

/**
 * `exdschema@2:rev:<hex>`, the field layout.
 *
 * A prefix check, not a pattern: the revision moves with every content patch and already differs between
 * editions, so pinning it would make an ordinary data update look like a migration.
 */
export const schemaTagSchema = z.string().startsWith('exdschema');
export const dataVersionSchema = z.string().min(1);

export const sheetResponseSchema = z.looseObject({ schema: schemaTagSchema, version: dataVersionSchema, rows: z.array(rowResultSchema) });
export type SheetResponse = z.infer<typeof sheetResponseSchema>;

/** A single row: {@link sheetResponseSchema} with `row_id`/`fields` flattened instead of wrapped in `rows`. */
export const rowResponseSchema = z.looseObject({
  schema: schemaTagSchema,
  version: dataVersionSchema,
  row_id: z.number(),
  subrow_id: z.number().nullish(),
  fields: fieldsSchema,
  transient: fieldsSchema.optional(),
});
export type RowResponse = z.infer<typeof rowResponseSchema>;

export const searchResponseSchema = z.looseObject({
  schema: schemaTagSchema,
  version: dataVersionSchema,
  next: z.string().nullish(),
  results: z.array(searchResultSchema),
});
export type SearchResponse = z.infer<typeof searchResponseSchema>;

export const listSheetsResponseSchema = z.looseObject({ sheets: z.array(z.looseObject({ name: z.string() })) });
export type ListSheetsResponse = z.infer<typeof listSheetsResponseSchema>;

export const versionInfoSchema = z.looseObject({ key: z.string(), names: z.array(z.string()) });
export type VersionInfo = z.infer<typeof versionInfoSchema>;

export const versionsResponseSchema = z.looseObject({ versions: z.array(versionInfoSchema) });
export type VersionsResponse = z.infer<typeof versionsResponseSchema>;

/** The error body, one shape on both editions. See the `hasVersionList` note for the exception. */
export const apiErrorSchema = z.looseObject({ code: z.number(), message: z.string() });
export type ApiErrorResponse = z.infer<typeof apiErrorSchema>;

/** Field shapes per sheet: optional throughout, because `fields=` decides what arrives. */
export const actionFieldsSchema = z.looseObject({
  Name: z.string().optional(),
  Description: z.string().optional(),
  ActionCategory: z.unknown().optional(),
  ClassJob: z.unknown().optional(),
  ClassJobCategory: z.unknown().optional(),
  ClassJobLevel: z.number().optional(),
  Cast100ms: z.number().optional(),
  Recast100ms: z.number().optional(),
  Range: z.number().optional(),
  EffectRange: z.number().optional(),
  PrimaryCostType: z.number().optional(),
  PrimaryCostValue: z.number().optional(),
});

export const statusFieldsSchema = z.looseObject({
  Name: z.string().optional(),
  Description: z.string().optional(),
  CanDispel: z.boolean().optional(),
  ClassJobCategory: z.unknown().optional(),
  MaxStacks: z.number().optional(),
});

export const itemFieldsSchema = z.looseObject({
  Name: z.string().optional(),
  Singular: z.string().optional(),
  Plural: z.string().optional(),
  Description: z.string().optional(),
  LevelItem: z.number().optional(),
  Rarity: z.number().optional(),
  StackSize: z.number().optional(),
  DyeCount: z.number().optional(),
  PriceMid: z.number().optional(),
  ItemUICategory: z.unknown().optional(),
  ItemSearchCategory: z.unknown().optional(),
  ClassJobCategory: z.unknown().optional(),
  EquipSlotCategory: z.unknown().optional(),
  /** What v1 and the Garland documents called `tradeable`, inverted; filterable server-side. */
  IsUntradable: z.boolean().optional(),
  IsUnique: z.boolean().optional(),
  IsCollectable: z.boolean().optional(),
});

/**
 * `Addon.Text` carries game markup (`<Switch(...)>`, `<Value>…</Value>`) and embedded newlines on most
 * rows, which is why the polyfill whitelists the handful that are plain.
 */
export const addonFieldsSchema = z.looseObject({ Text: z.string().optional() });

export const nameOnlyFieldsSchema = z.looseObject({ Name: z.string().optional() });

export const classJobFieldsSchema = z.looseObject({
  Name: z.string().optional(),
  Abbreviation: z.string().optional(),
  ClassJobCategory: z.unknown().optional(),
  JobIndex: z.number().optional(),
  JobType: z.number().optional(),
  StartingLevel: z.number().optional(),
  UIPriority: z.number().optional(),
});

export const itemSearchCategoryFieldsSchema = z.looseObject({
  Name: z.string().optional(),
  Icon: z.number().optional(),
  /** The parent `ItemSearchCategory` row — the real hierarchy, which the userscript guesses at by icon. */
  Category: z.unknown().optional(),
  ClassJob: z.unknown().optional(),
  Order: z.number().optional(),
});

export const itemUICategoryFieldsSchema = z.looseObject({
  Name: z.string().optional(),
  Icon: z.number().optional(),
  OrderMajor: z.number().optional(),
  OrderMinor: z.number().optional(),
});

/** The sheets with a declared field shape. Any other name is accepted, unmodelled. */
export const sheetFieldSchemas = {
  Action: actionFieldsSchema,
  ActionCategory: nameOnlyFieldsSchema,
  Addon: addonFieldsSchema,
  ClassJob: classJobFieldsSchema,
  ClassJobCategory: nameOnlyFieldsSchema,
  Item: itemFieldsSchema,
  ItemSearchCategory: itemSearchCategoryFieldsSchema,
  ItemUICategory: itemUICategoryFieldsSchema,
  Status: statusFieldsSchema,
} as const;

export type SheetName = keyof typeof sheetFieldSchemas;
export type SheetFields<T extends SheetName> = z.infer<(typeof sheetFieldSchemas)[T]>;

/** A row of `T`, with its declared field type. */
export interface SheetRow<T extends SheetName> {
  readonly row_id: number;
  readonly subrow_id?: number | null;
  readonly fields: SheetFields<T>;
  readonly transient?: Fields;
}
