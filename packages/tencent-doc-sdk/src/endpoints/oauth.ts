import { defineEndpoint } from '@/endpoint';
import { accessTokenQuerySchema, refreshTokenQuerySchema, tokenResponseSchema, userInfoResponseSchema } from '@/validation/schemas';

/**
 * The three OAuth endpoints: who an access token belongs to, and the two ways one is obtained.
 *
 * They speak their own vocabulary, which is why each names the shape it expects — `userinfo` answers inside
 * the smartsheet envelope but files the identity directly under `data`, and the token endpoint answers with
 * a bare body and no envelope at all. Neither one words the other's failure: a refused grant is an answer,
 * and only the caller knows whether that means "ask the operator" or "carry on with a fresh token". That
 * is what `envelope: false` buys — the table in `validation/classify.ts` declines to judge a body it has no
 * contract for, so a `400` naming a spent refresh token survives to be read by `token/manager.ts`.
 *
 * No `auth` mode here is `'headers'`: none of these three carries the three-piece header the Open API
 * demands. `userinfo` is asked about a token through its query string, and the two grants are addressed by
 * the application's own id and secret, which are declared as their `query` parameters rather than treated
 * as a credential — the secret renews a credential, it is not one, and it never enters the store.
 *
 * The two grants share one address and differ only by `grant_type`, which each states in its own query
 * schema. A literal there is worth the repetition of two declarations: it is the only thing that tells a
 * code exchange from a refresh, so naming it is the clearest place to record which one an endpoint is.
 *
 * See https://docs.qq.com/open/document/app/oauth2/user_info.html,
 * https://docs.qq.com/open/document/app/oauth2/access_token.html
 * and https://docs.qq.com/open/document/app/oauth2/refresh_token.html
 */

/** 获取用户信息: the credential's own identity. */
export const userinfo = defineEndpoint({
  operation: 'userinfo',
  path: '/oauth/v2/userinfo',
  method: 'GET',
  auth: 'query-token',
  response: { schema: userInfoResponseSchema, unwrap: (answer) => answer.data },
});

/** 获取 Token: exchanges an authorization code for a credential, which the answer states as a bare body. */
export const accessToken = defineEndpoint({
  operation: 'accessToken',
  path: '/oauth/v2/token',
  method: 'GET',
  auth: 'none',
  query: accessTokenQuerySchema,
  response: { schema: tokenResponseSchema, envelope: false },
});

/** 刷新 Token: exchanges a refresh token for a new access token, which may come with a new refresh token. */
export const refreshToken = defineEndpoint({
  operation: 'refreshToken',
  path: '/oauth/v2/token',
  method: 'GET',
  auth: 'none',
  query: refreshTokenQuerySchema,
  response: { schema: tokenResponseSchema, envelope: false },
});
