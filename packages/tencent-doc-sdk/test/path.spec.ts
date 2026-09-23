import { describe, expect, it } from 'vitest';
import { buildPath, encodePathSegment, pathPlaceholders } from '@/path';

/**
 * The one place a Tencent Docs path is interpolated.
 *
 * A document is addressed by an id that is not a path segment the way `encodeURIComponent` would leave it:
 * real ids carry a `$` (`300000000$ExAmPlEfIlEiD`), and escaping one produces a path the upstream answers
 * with a document that does not exist. And a coordinate is a value that arrives from a caller's
 * configuration, so it cannot be trusted to stay inside the segment it is dropped into. Those two facts
 * pull in opposite directions, which is why the escaping is per-value, at the moment of substitution, and
 * not a pass over the finished path: a finished pass would take the `$` with it, and no pass at all would
 * let one id speak as much path as it liked.
 */

describe('one path segment', () => {
  it('keeps the `$` and the `:` a real id carries', () => {
    expect(encodePathSegment('300000000$ExAmPlEfIlEiD')).toBe('300000000$ExAmPlEfIlEiD');
    expect(encodePathSegment('a:b$c')).toBe('a:b$c');
  });

  it('escapes what a path cannot carry', () => {
    expect(encodePathSegment('a/b')).toBe('a%2Fb');
    expect(encodePathSegment('a b')).toBe('a%20b');
    expect(encodePathSegment('a#b?c')).toBe('a%23b%3Fc');
    expect(encodePathSegment('a%b')).toBe('a%25b');
  });

  it('escapes a non-ASCII id rather than dropping it', () => {
    expect(encodePathSegment('表格')).toBe('%E8%A1%A8%E6%A0%BC');
  });
});

describe('interpolating a template', () => {
  it('addresses the sub-sheet list of one document, the `$` intact', () => {
    expect(buildPath('/openapi/smartbook/v2/files/{fileId}/sheets', { fileId: '300000000$ExAmPlEfIlEiD' })).toBe(
      '/openapi/smartbook/v2/files/300000000$ExAmPlEfIlEiD/sheets',
    );
  });

  it('fills every placeholder the template names', () => {
    expect(buildPath('/openapi/smartbook/v2/files/{fileId}/sheets/{sheetId}', { fileId: 'f', sheetId: 'tYYYYYY' })).toBe(
      '/openapi/smartbook/v2/files/f/sheets/tYYYYYY',
    );
  });

  it('escapes both ids on the way', () => {
    expect(buildPath('/openapi/smartbook/v2/files/{fileId}/sheets/{sheetId}', { fileId: 'a b', sheetId: 'c/d' })).toBe(
      '/openapi/smartbook/v2/files/a%20b/sheets/c%2Fd',
    );
  });

  it('keeps a value carrying separators inside the segment it was substituted into', () => {
    // The finding this function exists to make impossible: one id that says `/`, `#` or `?` must not be
    // able to open a segment, drop the query, or escape the origin. Encoded per value, it cannot.
    expect(buildPath('/files/{fileId}/sheets', { fileId: '../../admin' })).toBe('/files/..%2F..%2Fadmin/sheets');
    expect(buildPath('/files/{fileId}/sheets', { fileId: 'a?b=c' })).toBe('/files/a%3Fb%3Dc/sheets');
    expect(buildPath('/files/{fileId}/sheets', { fileId: 'a#b' })).toBe('/files/a%23b/sheets');
  });

  it('carries a value that says it is a template, as text', () => {
    // A `{` in an id is not a second round of interpolation: values are encoded, and the template itself is
    // the only thing parsed.
    expect(buildPath('/files/{fileId}', { fileId: '{sheetId}' })).toBe('/files/%7BsheetId%7D');
  });

  it('leaves a template with no placeholder alone', () => {
    expect(buildPath('/oauth/v2/token', { fileId: 'f', sheetId: 's' })).toBe('/oauth/v2/token');
  });

  it('names a placeholder the params do not carry, which is how a template and a schema disagree', () => {
    // `pupa` throws rather than substituting an empty segment. `client.ts` catches it as a `config` failure,
    // so a typo in a `path` is an error naming the placeholder instead of a request to a wrong address.
    expect(() => buildPath('/files/{fileId}/sheets/{sheetId}', { fileId: 'f' })).toThrow(/sheetId/);
  });
});

describe('the placeholders of a template', () => {
  it('lists each one once, for the check that a params schema can fill them all', () => {
    expect(pathPlaceholders('/openapi/smartbook/v2/files/{fileId}/sheets/{sheetId}')).toEqual(['fileId', 'sheetId']);
    expect(pathPlaceholders('/oauth/v2/token')).toEqual([]);
    expect(pathPlaceholders('/a/{x}/b/{x}')).toEqual(['x']);
  });
});
