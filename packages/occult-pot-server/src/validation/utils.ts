import { z } from 'zod';
import { AppError } from '@/errors.ts';

/**
 * Small parsing helpers shared by every validation module, plus the two error-shaping utilities
 * that turn a failed schema into the service's error envelope.
 */

export interface FieldIssue {
  readonly path: string;
  readonly message: string;
}

/** Flattens zod issues into `{path, message}` pairs, which is what a failure message is built from. */
export function formatIssues(error: z.ZodError, rootLabel = '(body)'): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length === 0 ? rootLabel : issue.path.join('.'),
    message: issue.message,
  }));
}

/**
 * Parses `value` with a schema, raising `ERR_BAD_REQUEST` with every offending field named in the
 * message. `value` is `unknown` because Express 5 exposes `req.body` and `req.params` loosely.
 */
export function parseWith<S extends z.ZodType>(schema: S, value: unknown, source: 'body' | 'query' | 'params'): z.infer<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const summary = formatIssues(result.error)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join('; ');
  throw new AppError('ERR_BAD_REQUEST', `Invalid ${source}: ${summary}`);
}

/**
 * Builds an integer schema for a value in either form it reaches the service in: the string an
 * environment variable carries, or the number an already-resolved configuration holds.
 *
 * The whole check lives in one refinement so every failure quotes the value the caller wrote —
 * `must be an integer, received "x"`, `must be <= 65535, received 99999` — which `z.int()` cannot
 * do once a string has been replaced by a number. Accepting both forms is what lets one schema
 * describe the environment and the resolved configuration alike.
 */
export function integerFrom(options: { min?: number; max?: number } = {}): z.ZodType<number> {
  return z.unknown().transform((value, ctx): number => {
    const parsed =
      typeof value === 'number' ? value : typeof value === 'string' && /^-?\d+$/.test(value.trim()) ? Number.parseInt(value.trim(), 10) : undefined;

    if (parsed === undefined || !Number.isInteger(parsed)) {
      ctx.addIssue({ code: 'custom', message: `must be an integer, received ${JSON.stringify(value)}` });
      return z.NEVER;
    }
    if (options.min !== undefined && parsed < options.min) {
      ctx.addIssue({ code: 'custom', message: `must be >= ${options.min}, received ${parsed}` });
      return z.NEVER;
    }
    if (options.max !== undefined && parsed > options.max) {
      ctx.addIssue({ code: 'custom', message: `must be <= ${options.max}, received ${parsed}` });
      return z.NEVER;
    }
    return parsed;
  });
}

/**
 * Builds a switch: `true`/`false` (and `1`/`0`), trimmed and case-insensitive, and nothing else.
 *
 * Unlike `booleanOrNumberFromString`, which exists for Express's `trust proxy` where a number and a
 * named subnet list are meaningful, a value that is not a switch is an error here — a sink is either
 * lazy or it is not.
 */
export function booleanFromString(): z.ZodType<boolean> {
  return z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim().toLowerCase();
      if (trimmed === 'true' || trimmed === '1') return true;
      if (trimmed === 'false' || trimmed === '0') return false;
      return value;
    },
    z.boolean({ error: 'must be true or false' }),
  ) as unknown as z.ZodType<boolean>;
}

/** Builds a string schema restricted to a fixed set; the failure names the allowed values. */
export function oneOf<T extends string>(allowed: readonly T[]): z.ZodType<T> {
  return z
    .preprocess((value) => value, z.string())
    .refine((value) => (allowed as readonly string[]).includes(value), {
      error: `must be one of ${allowed.join(', ')}`,
    }) as unknown as z.ZodType<T>;
}

/**
 * Builds a boolean-or-number flag schema such as Express's `trust proxy`: `true`/`false` become
 * booleans, digits become a hop count, and anything else is kept verbatim (a named subnet list).
 */
export function booleanOrNumberFromString(): z.ZodType<string | number | boolean> {
  return z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      if (trimmed === 'true') return true;
      if (trimmed === 'false' || trimmed === '') return false;
      if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
      return trimmed;
    },
    z.union([z.boolean(), z.int(), z.string()]),
  ) as unknown as z.ZodType<string | number | boolean>;
}

/** Parses a `*`, a comma-separated origin list, or an empty value (which means `*`). */
export function originListFromString(): z.ZodType<readonly string[] | '*'> {
  return z.preprocess(
    (value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      if (trimmed === '*') return '*';
      const items = trimmed
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      return items.length > 0 ? items : '*';
    },
    z.union([z.literal('*'), z.array(z.string())]),
  ) as unknown as z.ZodType<readonly string[] | '*'>;
}

/**
 * Flattens any smart sheet cell shape to a string. Text/link/select values arrive as arrays of
 * `{text|link, type}`; numbers, booleans and date timestamps arrive as primitives.
 */
export function parseCellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return value.map((entry) => parseCellText(entry)).join('');
  if (typeof value === 'object') {
    const entry = value as Record<string, unknown>;
    if (typeof entry.text === 'string') return entry.text;
    if (typeof entry.link === 'string') return entry.link;
  }
  return '';
}

/**
 * Parses a millisecond epoch cell, tolerating both string and numeric encodings.
 * An absent or unparsable cell yields `0`, which the pot rules then reject.
 */
export function parseCellEpochMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = parseCellText(value).trim();
  return /^-?\d+$/.test(text) ? Number.parseInt(text, 10) : 0;
}
