import { z } from 'zod';

/**
 * What a pot is, in both directions:
 *
 * - **The type** (`Pot`) is inferred from `potSchema`, so a pot has a single definition. It
 *   carries the five columns in the names this service uses, with instants in milliseconds.
 *   `isValidPot` applies the same schema to a row read back out of the sheet.
 * - **The request body** (`createPotBodySchema`) is the wire contract: `world`/`map`/`potId` are
 *   strings, and the two instants are epoch milliseconds accepted either as 13 digit strings or as
 *   numbers. Everything is still checked for width, so no date or time literal can reach the sheet.
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

export const potParamsSchema = z.object({ potId: potIdSchema });
