import { getConfig } from '@/config.ts';
import { asRecord } from '../classify.ts';
import { sendBare, sendEnvelope } from '../send.ts';

/**
 * The OAuth endpoints: who the credential belongs to, and how a refresh token becomes an access
 * token.
 *
 * They speak their own vocabulary — `userinfo` answers with the smartsheet envelope, the token
 * endpoint answers with the token itself and no envelope at all — which is why each function names
 * which answer to expect by picking `sendEnvelope` or `sendBare`. The credential lives in
 * `stores/upstream.ts`; this module only describes the two calls, and `send.ts` performs them under
 * the shared pacing.
 *
 * See https://docs.qq.com/open/document/app/oauth2/refresh_token.html
 */

/** The credential a token refresh needs; the secret never leaves the environment. */
export interface RefreshTokenInput {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

/** The credential's own identity, as `/oauth/v2/userinfo` reports it; the caller reads `openID`. */
export async function getUserInfo(accessToken: string): Promise<Record<string, unknown>> {
  const body = await sendEnvelope({
    ...target(apiUrl('/oauth/v2/userinfo', { access_token: accessToken })),
    method: 'GET',
    headers: {},
    operation: 'userinfo',
  });
  return asRecord(unwrap(body, 'userinfo'));
}

/** Exchanges a refresh token for a new access token. No envelope: the answer is the token itself. */
export async function refreshAccessToken(input: RefreshTokenInput): Promise<Record<string, unknown>> {
  const url = apiUrl('/oauth/v2/token', {
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
  });
  return asRecord(await sendBare({ ...target(url), method: 'GET', headers: {}, operation: 'refreshToken' }));
}

/** The section an envelope names, or the whole `data` when it names nothing. */
function unwrap(body: unknown, operation: string): unknown {
  const data = asRecord(asRecord(body).data);
  return data[operation] ?? data;
}

/** An absolute URL split the way the transport wants it. */
function target(url: string): { origin: string; path: string } {
  const parsed = new URL(url);
  return { origin: parsed.origin, path: `${parsed.pathname}${parsed.search}` };
}

/** An absolute URL on the configured origin, e.g. the user-info or token endpoint. */
function apiUrl(pathname: string, params: Record<string, string> = {}): string {
  const url = new URL(pathname, getConfig().docs.apiBase);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
}
