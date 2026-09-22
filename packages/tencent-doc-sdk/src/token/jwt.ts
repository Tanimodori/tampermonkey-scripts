import { jwtHeaderSchema, jwtPayloadSchema } from '@/validation/schemas.js';
import type { JwtHeader, JwtPayload } from '@/validation/types.js';

/**
 * Reading a lifetime and an identity out of an access token, for a caller that has to know when a
 * credential stops being usable.
 *
 * The signature is **not** verified: a forged token gets us nothing, because authorisation happens
 * upstream — and asking the upstream about the token (`userinfo`) is what actually decides it. This is
 * only for the case where the upstream stated no lifetime of its own.
 */

/** A token split into its three wire parts, each decoded as far as it decodes. */
export interface JwtToken {
  readonly header: JwtHeader;
  readonly payload: JwtPayload;
  /** The signature segment verbatim — never verified, only carried through so a reader sees the whole token. */
  readonly signature: string;
}

/** Decodes one base64url segment, tolerating missing padding. */
function decodeSegment(segment: string): unknown {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = padded.length % 4;
  const normalized = remainder === 0 ? padded : padded + '='.repeat(4 - remainder);
  return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
}

/**
 * The token split into `Header.Payload.Signature`, or `undefined` for anything that is not a decodable
 * three-segment token (opaque tokens, bad base64, non-object header or payload).
 *
 * The signature is returned exactly as the wire sent it; only the two JSON segments are decoded, and
 * each is validated against its schema with every key optional, so a token that carries more than this
 * library reads still parses.
 */
export function parseJwtToken(token: string): JwtToken | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    return {
      header: jwtHeaderSchema.parse(decodeSegment(parts[0])),
      payload: jwtPayloadSchema.parse(decodeSegment(parts[1])),
      signature: parts[2],
    };
  } catch {
    return undefined;
  }
}

/**
 * The payload claims of an access token, or `undefined` for anything that is not a decodable
 * three-segment token — which is what `parseJwtToken` reports, so a caller reading one part cannot be
 * handed a partially-read token it might mistake for a whole one.
 */
export function readAccessTokenClaims(token: string): JwtPayload | undefined {
  return parseJwtToken(token)?.payload;
}

/** The claims' `exp` as epoch milliseconds, when the token carries a usable one. */
export function readAccessTokenExpiresAt(token: string): number | undefined {
  const exp = parseJwtToken(token)?.payload.exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return undefined;
  return Math.round(exp * 1000);
}
