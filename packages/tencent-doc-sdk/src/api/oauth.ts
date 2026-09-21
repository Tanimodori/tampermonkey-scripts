import type { ClientContext } from '@/client/context.js';
import { assembleCall, sendBare, sendEnvelope } from '@/client/request.js';
import { TokenResponseSchema, UserInfoResponseSchema } from '@/validation/schemas.js';
import type { TokenResponse, UserInfo } from '@/validation/types.js';
import { oauthAddress } from './address.js';

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

/** The credential's own identity, as `/oauth/v2/userinfo` reports it. */
export function getUserInfo(apiBase: string, accessToken: string, context: ClientContext): Promise<UserInfo> {
  const call = assembleCall('userinfo', () => ({
    ...oauthAddress(apiBase, '/oauth/v2/userinfo', { access_token: accessToken }),
    method: 'GET',
    headers: {},
  }));
  return sendEnvelope(call, UserInfoResponseSchema, context).then((answer) => answer.data);
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

/** One call to `/oauth/v2/token`: the grant is only ever the query, and so is only ever stated there. */
function requestToken(
  operation: 'accessToken' | 'refreshToken',
  apiBase: string,
  query: Record<string, string>,
  context: ClientContext,
): Promise<TokenResponse> {
  const call = assembleCall(operation, () => ({ ...oauthAddress(apiBase, '/oauth/v2/token', query), method: 'GET', headers: {} }));
  return sendBare(call, TokenResponseSchema, context);
}
