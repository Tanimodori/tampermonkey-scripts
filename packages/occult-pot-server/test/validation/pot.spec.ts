import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  createPotBodySchema,
  docsOf,
  formatIssues,
  isValidPot,
  MAP_VALUES,
  potKey,
  POT_ID_PATTERN,
  potOf,
  potRecordSchema,
  WORLD_VALUES,
} from '@/validation/index.ts';
import type { FieldIssue, Pot } from '@/validation/index.ts';

/**
 * The pot's own rules, in both directions: the canonical `potSchema` a sheet row has to satisfy, and
 * the request body the wire carries. The HTTP tests assert the envelope those failures produce; these
 * assert the rules and the wording of each failure.
 */

const validPot: Pot = {
  world: '鸟',
  map: '北岛',
  potId: '54-1-4000E8F3',
  northRefreshAtMs: 1_789_200_960_000,
  lastVisitAtMs: 1_789_199_460_000,
};

/** The issues a rejected value reports, in the shape a failure message is built from. */
function issuesOf(schema: z.ZodType, value: unknown): FieldIssue[] {
  const result = schema.safeParse(value);
  if (result.success) throw new Error('expected the value to be rejected');
  return formatIssues(result.error);
}

describe('pot rules (isValidPot)', () => {
  it('accepts a well-formed pot', () => {
    expect(isValidPot(validPot)).toBe(true);
  });

  it('ignores fields beyond the five, which the schema strips', () => {
    const padded = { ...validPot, recordId: 'r1', stale: true, extraValues: { 备注: 'x' } } as Pot;

    expect(isValidPot(padded)).toBe(true);
  });

  it.each(WORLD_VALUES)('accepts the %s world', (world) => {
    expect(isValidPot({ ...validPot, world })).toBe(true);
  });

  it.each(MAP_VALUES)('accepts the %s map', (map) => {
    expect(isValidPot({ ...validPot, map })).toBe(true);
  });

  it('accepts lowercase hex in the pot ID', () => {
    expect(isValidPot({ ...validPot, potId: '54-1-4000e8f3' })).toBe(true);
  });

  it('accepts surrounding whitespace in the text fields', () => {
    expect(isValidPot({ ...validPot, world: ' 鸟 ', map: ' 北岛 ', potId: ' 54-1-4000E8F3 ' })).toBe(true);
  });

  it.each([
    ['world', { world: '鹰' }],
    ['map', { map: '东岛' }],
    ['potId shape', { potId: '54-1' }],
    ['potId length', { potId: '54-1-4000E8F' }],
    ['potId prefix', { potId: '54-1-5000E8F3' }],
    ['potId hex', { potId: '54-1-4000E8G3' }],
    ['north zero', { northRefreshAtMs: 0 }],
    ['north short', { northRefreshAtMs: 1_789_200_960 }],
    ['visit short', { lastVisitAtMs: 1_789 }],
  ])('rejects an invalid %s', (_label, patch) => {
    expect(isValidPot({ ...validPot, ...patch })).toBe(false);
  });

  it('recognises the documented pot ID shape', () => {
    expect(POT_ID_PATTERN.test('54-1-4000E8F3')).toBe(true);
    expect(POT_ID_PATTERN.test('54-1-5000E8F3')).toBe(false);
    expect(POT_ID_PATTERN.test('nope')).toBe(false);
  });
});

describe('createPotBodySchema', () => {
  const body = {
    world: '鸟',
    map: '北岛',
    potId: '60-0-4000ABCD',
    northRefreshAt: '1789201200000',
    lastVisitAt: '1789199700000',
  };

  it('accepts 13 digit epochs as strings', () => {
    expect(createPotBodySchema.safeParse(body).success).toBe(true);
  });

  it('accepts 13 digit epochs as numbers', () => {
    expect(createPotBodySchema.parse({ ...body, northRefreshAt: 1_789_201_200_000, lastVisitAt: 1_789_199_700_000 })).toMatchObject({
      northRefreshAt: 1_789_201_200_000,
      lastVisitAt: 1_789_199_700_000,
    });
  });

  it('trims the text fields, and hands the instants back as numbers', () => {
    expect(createPotBodySchema.parse({ ...body, world: ' 鸟 ', map: ' 北岛 ', potId: ' 60-0-4000ABCD ' })).toEqual({
      world: '鸟',
      map: '北岛',
      potId: '60-0-4000ABCD',
      northRefreshAt: 1_789_201_200_000,
      lastVisitAt: 1_789_199_700_000,
    });
  });

  it.each([
    ['an unknown world', { world: '鹰' }, 'world', 'must be one of 鸟/猫/猪/狗'],
    ['an unknown map', { map: '东岛' }, 'map', 'must be one of 北岛/南岛'],
    ['a malformed pot ID', { potId: 'nope' }, 'potId', 'must look like 54-1-4000E8F3'],
  ])('rejects %s with our own wording', (_label, patch, path, message) => {
    expect(issuesOf(createPotBodySchema, { ...body, ...patch })).toEqual([{ path, message }]);
  });

  it.each([
    ['a numeric world', { world: 5 }, 'world'],
    ['a numeric pot ID', { potId: 54_314_000 }, 'potId'],
  ])('rejects %s as the wrong type', (_label, patch, path) => {
    const [issue] = issuesOf(createPotBodySchema, { ...body, ...patch });

    expect(issue?.path).toBe(path);
    // Every text field is a string first, so the type failure is zod's own wording.
    expect(issue?.message).toMatch(/expected string/);
  });

  it.each([
    ['a wall-clock instant', '2026-09-12 16:20'],
    ['a time of day', '16:20'],
    ['epoch seconds', '1789201200'],
    ['epoch microseconds', '17892012000000000'],
    ['a fractional epoch', '1789201200000.7'],
    ['zero', '0'],
  ])('rejects %s as a north refresh instant', (_label, value) => {
    const [issue] = issuesOf(createPotBodySchema, { ...body, northRefreshAt: value });

    expect(issue?.path).toBe('northRefreshAt');
    expect(issue?.message).toContain('must be a 13 digit epoch in milliseconds, e.g. 1789201200000');
    expect(issue?.message).toContain(JSON.stringify(value));
  });

  it('rejects a fractional epoch passed as a number', () => {
    const [issue] = issuesOf(createPotBodySchema, { ...body, lastVisitAt: 1_789_201_200_000.7 });

    expect(issue?.path).toBe('lastVisitAt');
    expect(issue?.message).toContain('must be a 13 digit epoch in milliseconds');
  });

  it('names every missing field', () => {
    expect(
      issuesOf(createPotBodySchema, {})
        .map((issue) => issue.path)
        .sort(),
    ).toEqual(['lastVisitAt', 'map', 'northRefreshAt', 'potId', 'world']);
  });
});

/**
 * The record: a pot plus the document side. Nothing else reads that side — the API still answers a
 * bare `Pot` — so these cases pin that the two stay separable and that a row without a usable
 * identity is not given one.
 */
describe('PotRecord', () => {
  const docs = { recordId: 'rMW8vK', createTime: 1_789_100_000_000, updateTime: 1_789_199_000_000 };

  it('carries the five fields and the document side', () => {
    const parsed = potRecordSchema.safeParse({ ...validPot, docs });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.docs).toEqual(docs);
  });

  it('accepts a record with no document side at all', () => {
    const parsed = potRecordSchema.safeParse(validPot);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.docs).toBeUndefined();
  });

  it('still enforces the pot rules on a record', () => {
    expect(potRecordSchema.safeParse({ ...validPot, potId: 'nope', docs }).success).toBe(false);
    expect(potRecordSchema.safeParse({ ...validPot, docs: { ...docs, recordId: '' } }).success).toBe(false);
  });

  it('drops the document side from the pot a caller is served', () => {
    const record = { ...validPot, docs };

    // Key order is the pot's own: this is the object the API serialises.
    expect(potOf(record)).toEqual(validPot);
    expect(Object.keys(potOf(record))).toEqual(['world', 'map', 'potId', 'northRefreshAtMs', 'lastVisitAtMs']);
    // The same five fields in the same order, so the shape cannot drift by accident.
    expect(Object.keys(potOf(record))).toEqual(Object.keys(validPot));
  });

  it('keys a pot by the combination the document is expected to carry once', () => {
    expect(potKey(validPot)).toBe('鸟|北岛|54-1-4000E8F3');
    // The same pot in another world or on another island is another row.
    expect(potKey({ ...validPot, world: '猫' })).not.toBe(potKey(validPot));
    expect(potKey({ ...validPot, map: '南岛' })).not.toBe(potKey(validPot));
  });

  it('reads the document side off a sheet row, accepting both encodings of an instant', () => {
    expect(docsOf({ recordID: 'rMW8vK', createTime: '1789100000000', updateTime: 1789199000000 })).toEqual({
      recordId: 'rMW8vK',
      createTime: 1_789_100_000_000,
      updateTime: 1_789_199_000_000,
    });
  });

  it.each([
    ['no record id', { createTime: '1789100000000', updateTime: '1789199000000' }],
    ['an empty record id', { recordID: '', createTime: '1789100000000', updateTime: '1789199000000' }],
    ['no create time', { recordID: 'rMW8vK', updateTime: '1789199000000' }],
    ['a create time that is not a millisecond epoch', { recordID: 'rMW8vK', createTime: '2026-09-12', updateTime: '1789199000000' }],
    ['a seconds epoch', { recordID: 'rMW8vK', createTime: '1789100000', updateTime: '1789199000000' }],
    ['no update time', { recordID: 'rMW8vK', createTime: '1789100000000' }],
  ])('has no document side for a row with %s', (_name, row) => {
    expect(docsOf(row)).toBeUndefined();
  });
});
