import { getConfig } from '@/config.ts';
import type { RefreshTokenResponse, UserInfo } from '@/validation/upstream.ts';
import { RefreshTokenResponseSchema, UserInfoResponseSchema } from '@/validation/upstream.ts';
import { sendBare, sendEnvelope } from '../send.ts';

/**
 * The OAuth endpoints: who the credential belongs to, and how a refresh token becomes an access
 * token.
 *
 * They speak their own vocabulary — `userinfo` answers inside the smartsheet envelope, the token
 * endpoint answers with the token itself and no envelope at all — which is why each function names
 * which answer to expect by picking `sendEnvelope` or `sendBare`. Neither one words the other's
 * failure: a refused credential is `stores/upstream.ts`'s to describe, because only it knows whether
 * that means "ask the operator" or "carry on with a fresh token". The credential lives there; this
 * module only performs the two calls, and `send.ts` makes them under the shared pacing.
 *
 * See https://docs.qq.com/open/document/app/oauth2/refresh_token.html
 */

/** The credential a token refresh needs; the secret never leaves the environment. */
export interface RefreshTokenInput {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

/** The credential's own identity, as `/oauth/v2/userinfo` reports it. */
export async function getUserInfo(accessToken: string): Promise<UserInfo> {
  const answer = await sendEnvelope(
    {
      ...target(apiUrl('/oauth/v2/userinfo', { access_token: accessToken })),
      method: 'GET',
      headers: {},
      operation: 'userinfo',
    },
    UserInfoResponseSchema,
  );
  return answer.data;
}

/** Exchanges a refresh token for a new access token. No envelope: the answer is the token itself. */
export async function refreshAccessToken(input: RefreshTokenInput): Promise<RefreshTokenResponse> {
  const url = apiUrl('/oauth/v2/token', {
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
  });
  return sendBare({ ...target(url), method: 'GET', headers: {}, operation: 'refreshToken' }, RefreshTokenResponseSchema);
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
