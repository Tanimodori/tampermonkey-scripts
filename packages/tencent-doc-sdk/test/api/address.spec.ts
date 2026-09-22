import { describe, expect, it } from 'vitest';
import { encodePathSegment, oauthAddress, sheetAddress, sheetsAddress } from '@/api/address';

/**
 * The one place a Tencent Docs address is built.
 *
 * A document is addressed by an id that is not a path segment the way `encodeURIComponent` would leave
 * it: real ids carry a `$` (`300000000$ExAmPlEfIlEiD`), and escaping one produces a path the upstream
 * answers with a document that does not exist. The OAuth endpoints go the other way and put their
 * credential in the query string, which is what every report downstream has to keep out.
 */

const API_BASE = 'https://docs.qq.com';
const target = (fileId: string, sheetId = 'tXXXXXX') => ({ apiBase: API_BASE, coordinates: { fileId, sheetId } });

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

describe('the document paths', () => {
  it('addresses the sub-sheet list of one document', () => {
    expect(sheetsAddress(target('300000000$ExAmPlEfIlEiD'))).toEqual({
      origin: API_BASE,
      path: '/openapi/smartbook/v2/files/300000000$ExAmPlEfIlEiD/sheets',
    });
  });

  it('addresses one sub-sheet of it', () => {
    expect(sheetAddress(target('300000000$ExAmPlEfIlEiD', 'tYYYYYY'))).toEqual({
      origin: API_BASE,
      path: '/openapi/smartbook/v2/files/300000000$ExAmPlEfIlEiD/sheets/tYYYYYY',
    });
  });

  it('escapes both ids on the way', () => {
    expect(sheetAddress(target('a b', 'c/d')).path).toBe('/openapi/smartbook/v2/files/a%20b/sheets/c%2Fd');
  });

  it('takes the origin from the configured base, not from the production host', () => {
    expect(sheetsAddress({ apiBase: 'http://127.0.0.1:3100', coordinates: { fileId: 'f', sheetId: 's' } })).toEqual({
      origin: 'http://127.0.0.1:3100',
      path: '/openapi/smartbook/v2/files/f/sheets',
    });
  });
});

describe('the OAuth paths', () => {
  it('carries the parameters a call was given, in the order it named them', () => {
    const addressed = oauthAddress(API_BASE, '/oauth/v2/token', { client_id: 'cid', grant_type: 'refresh_token', refresh_token: 'rt' });

    expect(addressed).toEqual({ origin: API_BASE, path: '/oauth/v2/token?client_id=cid&grant_type=refresh_token&refresh_token=rt' });
  });

  it('encodes a value that is not URL-safe, which is what a real secret often is', () => {
    expect(oauthAddress(API_BASE, '/oauth/v2/userinfo', { access_token: 'a+b/c=' }).path).toBe('/oauth/v2/userinfo?access_token=a%2Bb%2Fc%3D');
  });

  it('is a bare path when there is nothing to carry', () => {
    expect(oauthAddress(API_BASE, '/oauth/v2/userinfo', {}).path).toBe('/oauth/v2/userinfo');
  });

  it('reads the same whether the configured base carries a trailing slash or not', () => {
    const query = { access_token: 't' };

    expect(oauthAddress('https://docs.qq.com/', '/oauth/v2/userinfo', query)).toEqual(oauthAddress('https://docs.qq.com', '/oauth/v2/userinfo', query));
  });
});
