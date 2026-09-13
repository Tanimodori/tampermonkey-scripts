import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '@/errors.ts';
import {
  booleanOrNumberFromString,
  formatIssues,
  integerFrom,
  oneOf,
  originListFromString,
  parseCellEpochMs,
  parseCellText,
  parseWith,
} from '@/validation/index.ts';

/**
 * The shared parsing helpers: the schema builders the configuration is made of, the two error-shaping
 * utilities, and the cell parsers the sheet mapping relies on. Each one is small and used everywhere,
 * so these tests pin the exact wording and the exact coercion.
 */

describe('integerFrom', () => {
  const schema = integerFrom({ min: 0, max: 100 });

  /** The message of the first issue a refused value reports. */
  const issueOf = (value: unknown): string | undefined => {
    const result = schema.safeParse(value);
    return result.success ? undefined : result.error.issues[0]?.message;
  };

  it('accepts a number and a numeric string alike', () => {
    expect(schema.parse(5)).toBe(5);
    expect(schema.parse('5')).toBe(5);
    expect(schema.parse(' 5 ')).toBe(5);
    expect(schema.parse('0')).toBe(0);
  });

  it('quotes the value it refused', () => {
    expect(issueOf('x')).toMatch(/must be an integer, received "x"/);
    expect(issueOf(1.5)).toMatch(/must be an integer, received 1.5/);
    expect(issueOf(undefined)).toMatch(/must be an integer, received undefined/);
  });

  it('enforces the bounds it was given', () => {
    expect(issueOf(-1)).toMatch(/must be >= 0, received -1/);
    expect(issueOf(101)).toMatch(/must be <= 100, received 101/);
    expect(integerFrom().parse(-5)).toBe(-5);
  });
});

describe('oneOf', () => {
  const schema = oneOf(['a', 'b'] as const);

  it('accepts a listed value only', () => {
    expect(schema.parse('a')).toBe('a');
    expect(schema.safeParse('c').success).toBe(false);
  });

  it('names the allowed values', () => {
    expect(() => schema.parse('c')).toThrow(/must be one of a, b/);
  });
});

describe('booleanOrNumberFromString', () => {
  const schema = booleanOrNumberFromString();

  it('reads the three forms Express accepts for a flag', () => {
    expect(schema.parse('true')).toBe(true);
    expect(schema.parse('false')).toBe(false);
    expect(schema.parse('')).toBe(false);
    expect(schema.parse('3')).toBe(3);
  });

  it('keeps anything else verbatim, so a named subnet list survives', () => {
    expect(schema.parse(' loopback ')).toBe('loopback');
    expect(schema.parse('10.0.0.0/8')).toBe('10.0.0.0/8');
  });
});

describe('originListFromString', () => {
  const schema = originListFromString();

  it('keeps a wildcard as a wildcard', () => {
    expect(schema.parse('*')).toBe('*');
  });

  it('splits a comma-separated list and trims it', () => {
    expect(schema.parse('https://a.example, https://b.example')).toEqual(['https://a.example', 'https://b.example']);
  });

  it('reads an empty value as a wildcard rather than an empty list', () => {
    expect(schema.parse('')).toBe('*');
    expect(schema.parse(' , , ')).toBe('*');
  });
});

describe('formatIssues', () => {
  it('flattens zod issues into the pairs the error envelope carries', () => {
    const result = z.object({ a: z.string(), b: z.number() }).safeParse({ a: 1, b: 'x' });
    if (result.success) throw new Error('expected the value to be rejected');

    expect(formatIssues(result.error)).toEqual([
      { path: 'a', message: expect.stringContaining('expected string') },
      { path: 'b', message: expect.stringContaining('expected number') },
    ]);
  });

  it('labels a root-level issue', () => {
    const result = z.string().safeParse(5);
    if (result.success) throw new Error('expected the value to be rejected');

    expect(formatIssues(result.error)[0]?.path).toBe('(body)');
    expect(formatIssues(result.error, '(params)')[0]?.path).toBe('(params)');
  });

  it('joins a nested path', () => {
    const result = z.object({ records: z.array(z.object({ values: z.string() })) }).safeParse({ records: [{ values: 1 }] });
    if (result.success) throw new Error('expected the value to be rejected');

    expect(formatIssues(result.error)[0]?.path).toBe('records.0.values');
  });
});

describe('parseWith', () => {
  const schema = z.object({ potId: z.string() });

  it('returns the parsed value', () => {
    expect(parseWith(schema, { potId: '54-1-4000E8F3' }, 'body')).toEqual({ potId: '54-1-4000E8F3' });
  });

  it('raises BAD_REQUEST with the source and the field issues', () => {
    try {
      parseWith(schema, { potId: 5 }, 'params');
      throw new Error('expected parseWith to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe('BAD_REQUEST');
      expect(appError.status).toBe(400);
      expect(appError.message).toContain('Invalid params: potId:');
      expect(appError.details).toMatchObject({ source: 'params', issues: [{ path: 'potId' }] });
    }
  });
});

describe('parseCellText', () => {
  it('reads the shapes a smart sheet cell arrives in', () => {
    expect(parseCellText([{ text: '鸟', type: 'text' }])).toBe('鸟');
    expect(parseCellText({ text: '鸟' })).toBe('鸟');
    expect(parseCellText([{ link: 'https://docs.qq.com/x', text: '腾讯文档' }])).toBe('腾讯文档');
    expect(parseCellText({ link: 'https://docs.qq.com/x' })).toBe('https://docs.qq.com/x');
    expect(parseCellText('鸟')).toBe('鸟');
    expect(parseCellText(412)).toBe('412');
    expect(parseCellText(true)).toBe('true');
  });

  it('joins a multi-part cell', () => {
    expect(parseCellText([{ text: '鸟' }, { text: '-北岛' }])).toBe('鸟-北岛');
  });

  it('reads anything unusable as empty text', () => {
    expect(parseCellText(null)).toBe('');
    expect(parseCellText(undefined)).toBe('');
    expect(parseCellText({})).toBe('');
    expect(parseCellText([])).toBe('');
  });
});

describe('parseCellEpochMs', () => {
  it('takes a number as it is and a numeric string as its value', () => {
    expect(parseCellEpochMs(1_789_200_000_000)).toBe(1_789_200_000_000);
    expect(parseCellEpochMs('1789200000000')).toBe(1_789_200_000_000);
    expect(parseCellEpochMs(' 1789200000000 ')).toBe(1_789_200_000_000);
    expect(parseCellEpochMs([{ text: '1789200000000' }])).toBe(1_789_200_000_000);
  });

  it('yields zero for anything it cannot read, which the pot rules then reject', () => {
    expect(parseCellEpochMs('')).toBe(0);
    expect(parseCellEpochMs('2026-09-12 16:20')).toBe(0);
    expect(parseCellEpochMs(null)).toBe(0);
    expect(parseCellEpochMs(Number.NaN)).toBe(0);
  });

  it('keeps a negative value as a number, because the width rule is what rejects it', () => {
    expect(parseCellEpochMs('-5')).toBe(-5);
  });
});
