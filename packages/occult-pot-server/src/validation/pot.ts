import { z } from 'zod';

/**
 * What a pot is, in both directions, and the vocabulary its state is described in:
 *
 * - **The type** (`Pot`) is inferred from `potSchema`, so a pot has a single definition. It
 *   carries the five columns in the names this service uses, with instants in milliseconds.
 *   `isValidPot` applies the same schema to a row read back out of the sheet.
 * - **The record** (`PotRecord`) is that pot plus `docs`: which row of the sheet it lives in and
 *   when this service last wrote it. It is what the cache holds and what a read produces; the API
 *   never exposes it (`potOf` is what a caller gets).
 * - **The request body** (`createPotBodySchema`) is the wire contract: `world`/`map`/`potId` are
 *   strings, and the two instants are epoch milliseconds accepted either as 13 digit strings or as
 *   numbers. Everything is still checked for width, so no date or time literal can reach the sheet.
 * - **The state** (`PotState`) is a pure type: the records a store holds, and when the sheet was
 *   last read into it.
 */

/** `区服` — the only four servers the client script accepted. */
export const WORLD_VALUES = ['鸟', '猫', '猪', '狗'] as const;
/** `地图` — the only two islands. */
export const MAP_VALUES = ['北岛', '南岛'] as const;

/** `54-1-4000E8F3`: two numeric segments then an 8 char, `400`-prefixed hex segment. */
export const POT_ID_PATTERN = /^\d+-\d+-400[0-9A-Fa-f]{5}$/;
/** The sheet stores both instants as 13 digit epoch milliseconds. */
export const EPOCH_MS_PATTERN = /^\d{13}$/;

// Each field gets its own named schema: the request body reuses them under its wire names, and a
// failure carries the field it came from as its zod path.

const worldSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => (WORLD_VALUES as readonly string[]).includes(value), { error: `must be one of ${WORLD_VALUES.join('/')}` });

const mapSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => (MAP_VALUES as readonly string[]).includes(value), { error: `must be one of ${MAP_VALUES.join('/')}` });

const potIdSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => POT_ID_PATTERN.test(value), { error: 'must look like 54-1-4000E8F3' });

/**
 * A north refresh instant as a **number**, matching the 13 digit values the sheet stores. Zero is
 * not "unknown but usable": the client script treated a zero north refresh time as an invalid row
 * and deleted it, so it is not a pot.
 */
const northRefreshSchema = z.int().refine((value) => EPOCH_MS_PATTERN.test(String(value)), { error: 'must be a 13 digit epoch millisecond value' });

/** A last-visit instant as a number, under the same 13 digit rule. */
const lastVisitSchema = z.int().refine((value) => EPOCH_MS_PATTERN.test(String(value)), { error: 'must be a 13 digit epoch millisecond value' });

/** The canonical pot: five fields, instants as numbers. `Pot` is inferred from this. */
export const potSchema = z.object({
  world: worldSchema,
  map: mapSchema,
  potId: potIdSchema,
  northRefreshAtMs: northRefreshSchema,
  lastVisitAtMs: lastVisitSchema,
});

export type Pot = Readonly<z.infer<typeof potSchema>>;

/**
 * True when the input satisfies every rule above. This is the only consumer of the rules besides
 * the request schema: it is applied to rows read back out of the sheet, where a row that cannot be
 * a pot is dropped rather than repaired.
 */
export function isValidPot(input: Pot): boolean {
  return potSchema.safeParse(input).success;
}

/**
 * An epoch in milliseconds, accepted as **either** a 13 digit string or a JSON number.
 *
 * Numbers are allowed here because an epoch is the one value whose width makes it safe: with the
 * 13 digit check in place the largest accepted value is `9_999_999_999_999`, two thousand times
 * below `Number.MAX_SAFE_INTEGER`, so a double carries it exactly. The width check is what makes
 * the leniency harmless — anything unrepresentable is refused rather than silently rounded.
 */
const epochMsSchema = z.unknown().transform((value, ctx): number => {
  const text = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : undefined;
  if (text === undefined || !EPOCH_MS_PATTERN.test(text)) {
    ctx.addIssue({ code: 'custom', message: `must be a 13 digit epoch in milliseconds, e.g. 1789201200000, received ${JSON.stringify(value)}` });
    return z.NEVER;
  }
  return Number.parseInt(text, 10);
});

/**
 * The write request body: the canonical `world`/`map`/`potId` schemas, and the two instants under
 * their wire names (`northRefreshAt`, `lastVisitAt`).
 */
export const createPotBodySchema = z.object({
  world: worldSchema,
  map: mapSchema,
  potId: potIdSchema,
  northRefreshAt: epochMsSchema,
  lastVisitAt: epochMsSchema,
});

export type CreatePotBody = z.infer<typeof createPotBodySchema>;

/**
 * Where a pot's row sits in the sheet, and when this service last touched it.
 *
 * Both instants are epoch milliseconds, and both are **this service's** clock rather than the
 * document's: `createTime` is when the row was first written here and `updateTime` when it was last
 * written, which is what makes "was this ever re-uploaded?" answerable without another read. The
 * document's own `createTime`/`updateTime` arrive only on `getRecords`, and `update_records` does
 * not report them at all, so they cannot be the source of these.
 */
export const potDocsSchema = z.object({
  recordId: z.string().min(1),
  createTime: z.int(),
  updateTime: z.int(),
});

/** The document side of a pot: the row it lives in, and when this service wrote it. */
export type PotDocs = Readonly<z.infer<typeof potDocsSchema>>;

/**
 * A pot plus what the sheet knows about it: the canonical five fields, and the row they came from
 * (or were written to).
 *
 * This is what the cache holds and what a read produces. `docs` is absent when there is no row
 * identity to speak of — a state written by an older version of this service, or a row the document
 * answered without a `recordID`. The API never exposes it: a caller is served the `Pot` alone.
 */
export const potRecordSchema = potSchema.extend({ docs: potDocsSchema.optional() });

export type PotRecord = Readonly<z.infer<typeof potRecordSchema>>;

/** The row key: the combination the document is expected to carry at most one row for. */
export function potKey(pot: Pot): string {
  return `${pot.world}|${pot.map}|${pot.potId}`;
}

/** A record's canonical pot, without the document side: what every caller outside this service sees. */
export function potOf(record: PotRecord): Pot {
  return {
    world: record.world,
    map: record.map,
    potId: record.potId,
    northRefreshAtMs: record.northRefreshAtMs,
    lastVisitAtMs: record.lastVisitAtMs,
  };
}

/**
 * A record's document side as the API reports it, or `undefined` when it carries nothing usable.
 *
 * The timestamps are accepted in either encoding (`"1789201200000"` or `1789201200000`) because the
 * sheet is inconsistent about it; a row without a `recordID`, or with an instant that is not a
 * millisecond epoch, has no usable identity and is treated as not having one.
 */
export function docsOf(record: { readonly recordID?: unknown; readonly createTime?: unknown; readonly updateTime?: unknown }): PotDocs | undefined {
  const recordId = record.recordID;
  if (typeof recordId !== 'string' || recordId.length === 0) return undefined;

  const createTime = epochMsOf(record.createTime);
  const updateTime = epochMsOf(record.updateTime);
  if (createTime === undefined || updateTime === undefined) return undefined;

  return { recordId, createTime, updateTime };
}

/** A cell as epoch milliseconds, or `undefined` when it is not one. */
function epochMsOf(value: unknown): number | undefined {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!EPOCH_MS_PATTERN.test(text)) return undefined;
  return Number.parseInt(text, 10);
}

/** The pot list a store holds. */
export interface PotState {
  /** The records, in sheet order, with whatever has been written since the sheet was read. */
  readonly data: readonly PotRecord[];
  /** Epoch ms of the sheet read this list came from; `0` means the sheet has never been read. */
  readonly updateTime: number;
}
