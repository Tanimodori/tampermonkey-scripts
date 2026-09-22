import type { FetcherRequestInit } from '@apollo/utils.fetcher';
import type { ClientContext } from '@/client/context';
import { request } from '@/client/request';
import { cannotAssemble } from '@/validation/classify';
import { tokenResponseSchema, userInfoResponseSchema } from '@/validation/schemas';
import type { TokenResponse, UserInfo } from '@/validation/types';
import { oauthUrl } from './address';

/**
 * The three OAuth endpoints: who an access token belongs to, and the two ways one is obtained.
 *
 * They speak their own vocabulary, which is why each names the shape it expects — `userinfo` answers
 * inside the smartsheet envelope but files the identity directly under `data`, and the token endpoint
 * answers with a bare body and no envelope at all. Neither one words the other's failure: a refused
 * grant is an answer, and only the caller knows whether that means "ask the operator" or "carry on with
 * a fresh token".
 *
 * The two grants share one URL and differ only by `grant_type`, which is why they share one request here
 * rather than restating a path that has to agree with the other's forever.
 *
 * See https://docs.qq.com/open/document/app/oauth2/user_info.html,
 * https://docs.qq.com/open/document/app/oauth2/access_token.html
 * and https://docs.qq.com/open/document/app/oauth2/refresh_token.html
 */

/** What either grant needs from the application the credential belongs to. */
export interface TokenGrant {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** 获取 Token: the authorization code just issued to a user, and the address it was issued for. */
export interface AccessTokenInput extends TokenGrant {
  readonly code: string;
  readonly redirectUri: string;
}

/** 刷新 Token: the refresh token held so far, which the answer may replace. */
export interface RefreshTokenInput extends TokenGrant {
  readonly refreshToken: string;
}

/**
 * The address and the request of one credential call, or the `config` failure explaining why neither
 * exists.
 *
 * Neither grant has a request body — the whole of both is the query string — so the only thing that can
 * fail here is an `apiBase` that is not a URL.
 */
function prepare(
  operation: string,
  apiBase: string,
  pathname: string,
  query: Record<string, string>,
): { readonly url: URL; readonly init: FetcherRequestInit } {
  try {
    return { url: oauthUrl(apiBase, pathname, query), init: { method: 'GET' } };
  } catch (error) {
    throw cannotAssemble(operation, error);
  }
}

/** The credential's own identity, as `/oauth/v2/userinfo` reports it. */
export async function getUserInfo(apiBase: string, accessToken: string, context: ClientContext): Promise<UserInfo> {
  const operation = 'userinfo';
  const { init, url } = prepare(operation, apiBase, '/oauth/v2/userinfo', { access_token: accessToken });
  const answer = await request(url, init, { ...context, operation, envelope: true, responseSchema: userInfoResponseSchema });
  return answer.data;
}

/** 获取 Token: exchanges an authorization code for the credential that answers with a bare body. */
export function fetchAccessToken(apiBase: string, input: AccessTokenInput, context: ClientContext): Promise<TokenResponse> {
  return requestToken(
    'accessToken',
    apiBase,
    {
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
    },
    context,
  );
}

/** 刷新 Token: exchanges a refresh token for a new access token, which may come with a new refresh token. */
export function refreshAccessToken(apiBase: string, input: RefreshTokenInput, context: ClientContext): Promise<TokenResponse> {
  return requestToken(
    'refreshToken',
    apiBase,
    {
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
    },
    context,
  );
}

/**
 * One call to `/oauth/v2/token`: the grant is only ever the query, and so is only ever stated there.
 *
 * `envelope: false` is what makes a refused grant survive as an answer. The token endpoint words its own
 * failures — a bad code or a spent refresh token is a `400` with a body in its own vocabulary — and that
 * body is the caller's to read, not this library's to judge.
 */
function requestToken(
  operation: 'accessToken' | 'refreshToken',
  apiBase: string,
  query: Record<string, string>,
  context: ClientContext,
): Promise<TokenResponse> {
  const { init, url } = prepare(operation, apiBase, '/oauth/v2/token', query);
  return request(url, init, { ...context, operation, envelope: false, responseSchema: tokenResponseSchema });
}
