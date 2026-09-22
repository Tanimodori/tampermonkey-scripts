import { describe, expect, it } from 'vitest';
import { parseJwtToken, readAccessTokenClaims, readAccessTokenExpiresAt } from '@/token/jwt.js';

/**
 * Reading a lifetime and an identity off an access token.
 *
 * The signature is never verified: the upstream decides whether a token works, and this is only for the
 * case where it stated no lifetime of its own. So the whole contract is *reading* — a token that is not
 * a token answers `undefined`, which its callers read as "unknown" rather than as "expired".
 */

function segment(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function token(payload: unknown): string {
  return `${segment({ alg: 'HS256', typ: 'JWT' })}.${segment(payload)}.a-signature`;
}

describe('the three parts', () => {
  it('decodes the header and payload and hands the signature back verbatim', () => {
    const raw = `${segment({ alg: 'HS256', typ: 'JWT' })}.${segment({ clt: 'client-id', typ: 1, exp: 1_790_621_942.196758, iat: 1_788_029_942.196758, sub: 'open-id' })}.the-signature-as-sent`;
    const parsed = parseJwtToken(raw);

    expect(parsed?.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(parsed?.payload).toMatchObject({ clt: 'client-id', typ: 1, exp: 1_790_621_942.196758, iat: 1_788_029_942.196758, sub: 'open-id' });
    // The signature is never decoded or checked — only carried through untouched.
    expect(parsed?.signature).toBe('the-signature-as-sent');
  });

  it('keeps payload keys it does not declare, because looseness is about extra claims', () => {
    expect(parseJwtToken(token({ scope: 'all' }))?.payload).toMatchObject({ scope: 'all' });
  });

  it('is nothing for a token that is not three decodable segments', () => {
    expect(parseJwtToken('an-opaque-token')).toBeUndefined();
    expect(parseJwtToken(`${segment({ exp: 1 })}.${segment({ exp: 1 })}`)).toBeUndefined();
    expect(parseJwtToken('a.b.c.d')).toBeUndefined();
    expect(parseJwtToken('')).toBeUndefined();
    // A header or payload that is not a JSON object fails the whole token, not just that part.
    expect(parseJwtToken(`${segment({ alg: 'HS256' })}.${segment([1, 2, 3])}.s`)).toBeUndefined();
    expect(parseJwtToken(`${Buffer.from('not json').toString('base64url')}.${segment({ exp: 1 })}.s`)).toBeUndefined();
  });
});

describe('the claims', () => {
  it('reads the payload without checking the signature', () => {
    expect(readAccessTokenClaims(token({ exp: 1_791_732_693, sub: 'open-id', scope: 'all' }))).toEqual({ exp: 1_791_732_693, sub: 'open-id', scope: 'all' });
  });

  it('tolerates a payload whose base64url needed padding', () => {
    // Ten characters of it: `Buffer#toString('base64url')` leaves the two `=` off the end.
    const bare = `${segment({ alg: 'HS256' })}.${Buffer.from('{"exp":12}', 'utf8').toString('base64url')}.c2ln`;

    expect(readAccessTokenClaims(bare)).toEqual({ exp: 12 });
  });

  it('is nothing for a token with the wrong number of segments', () => {
    expect(readAccessTokenClaims('an-opaque-token')).toBeUndefined();
    expect(readAccessTokenClaims(`${segment({ exp: 1 })}.${segment({ exp: 1 })}`)).toBeUndefined();
    expect(readAccessTokenClaims('a.b.c.d')).toBeUndefined();
    expect(readAccessTokenClaims('')).toBeUndefined();
  });

  it('is nothing for a payload that is not a JSON object', () => {
    expect(readAccessTokenClaims(`${segment({ alg: 'HS256' })}.${segment([1, 2, 3])}.s`)).toBeUndefined();
    expect(readAccessTokenClaims(`${segment({ alg: 'HS256' })}.${Buffer.from('not json').toString('base64url')}.s`)).toBeUndefined();
  });

  it('is nothing for a payload that carries a lifetime of the wrong type', () => {
    expect(readAccessTokenClaims(token({ exp: '1791732693' }))).toBeUndefined();
    expect(readAccessTokenClaims(token({ exp: { seconds: 1 } }))).toBeUndefined();
  });

  it('says nothing about a token it cannot read, rather than guessing a lifetime', () => {
    const claims = readAccessTokenClaims(token({ sub: 'open-id' }));

    expect(claims).toMatchObject({ sub: 'open-id' });
    expect(claims?.exp).toBeUndefined();
  });
});

describe('the expiry', () => {
  it('is the `exp` claim in epoch milliseconds', () => {
    expect(readAccessTokenExpiresAt(token({ exp: 1_791_732_693 }))).toBe(1_791_732_693_000);
  });

  it('rounds a sub-second claim rather than truncating it', () => {
    expect(readAccessTokenExpiresAt(token({ exp: 1_791_732_693.5 }))).toBe(1_791_732_693_500);
    expect(readAccessTokenExpiresAt(token({ exp: 1_791_732_693.4 }))).toBe(1_791_732_693_400);
  });

  it('is unknown for a token with no lifetime, an unreadable one, or a lifetime that is not a number', () => {
    expect(readAccessTokenExpiresAt(token({ sub: 'open-id' }))).toBeUndefined();
    expect(readAccessTokenExpiresAt('an-opaque-token')).toBeUndefined();
    expect(readAccessTokenExpiresAt(token({ exp: 'later' }))).toBeUndefined();
  });
});
