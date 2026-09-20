import { accessTokenClaimsSchema } from '@/validation/schemas.js';
import type { AccessTokenClaims } from '@/validation/types.js';

/**
 * Reading a lifetime and an identity out of an access token, for a caller that has to know when a
 * credential stops being usable.
 *
 * The signature is **not** verified: a forged token gets us nothing, because authorisation happens
 * upstream — and asking the upstream about the token (`userinfo`) is what actually decides it. This is
 * only for the case where the upstream stated no lifetime of its own.
 */

/** Decodes one base64url segment, tolerating missing padding. */
function decodeSegment(segment: string): unknown {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = padded.length % 4;
  const normalized = remainder === 0 ? padded : padded + '='.repeat(4 - remainder);
  return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
}

/**
 * The claims of an access token, or `undefined` for anything that is not a decodable three-segment
 * token (opaque tokens, bad base64, non-object payloads).
 */
export function readAccessTokenClaims(token: string): AccessTokenClaims | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    // A payload that is not an object, or that carries an `exp` of the wrong type, is not a token
    // anybody can read a lifetime out of — which is what `undefined` means to its callers.
    return accessTokenClaimsSchema.parse(decodeSegment(parts[1]!));
  } catch {
    return undefined;
  }
}

/** The claims' `exp` as epoch milliseconds, when the token carries a usable one. */
export function readAccessTokenExpiresAt(token: string): number | undefined {
  const claims = readAccessTokenClaims(token);
  if (typeof claims?.exp !== 'number' || !Number.isFinite(claims.exp)) return undefined;
  return Math.round(claims.exp * 1000);
}
