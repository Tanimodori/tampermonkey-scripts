import type { CallContext } from '@/client/request.js';
import { sendBare, sendEnvelope } from '@/client/request.js';
import { RefreshTokenResponseSchema, UserInfoResponseSchema } from '@/validation/schemas.js';
import type { RefreshTokenResponse, UserInfo } from '@/validation/types.js';
import { oauthAddress } from './address.js';

/**
 * The two OAuth endpoints: who an access token belongs to, and how a refresh token becomes a new one.
 *
 * They speak their own vocabulary, which is why each names the shape it expects — `userinfo` answers
 * inside the smartsheet envelope but files the identity directly under `data`, and the token endpoint
 * answers with a bare body and no envelope at all. Neither one words the other's failure: a refused
 * refresh is an answer, and only the caller knows whether that means "ask the operator" or "carry on
 * with a fresh token".
 *
 * See https://docs.qq.com/open/document/app/oauth2/user_info.html
 * and https://docs.qq.com/open/document/app/oauth2/refresh_token.html
 */

/** The credential a token refresh needs. */
export interface RefreshTokenInput {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

/** The credential's own identity, as `/oauth/v2/userinfo` reports it. */
export function getUserInfo(apiBase: string, accessToken: string, context: CallContext): Promise<UserInfo> {
  const call = { ...oauthAddress(apiBase, '/oauth/v2/userinfo', { access_token: accessToken }), method: 'GET' as const, headers: {}, operation: 'userinfo' };
  return sendEnvelope(call, UserInfoResponseSchema, context).then((answer) => answer.data);
}

/** Exchanges a refresh token for a new access token. No envelope: the answer is the token itself. */
export function refreshAccessToken(apiBase: string, input: RefreshTokenInput, context: CallContext): Promise<RefreshTokenResponse> {
  const query = {
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
  };
  const call = { ...oauthAddress(apiBase, '/oauth/v2/token', query), method: 'GET' as const, headers: {}, operation: 'refreshToken' };
  return sendBare(call, RefreshTokenResponseSchema, context);
}
