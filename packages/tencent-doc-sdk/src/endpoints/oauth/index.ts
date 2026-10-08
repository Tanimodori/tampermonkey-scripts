import { getBareAnswer, getEnvelope, verifyEnvelope } from '@/client/error';
import type { TDocEndpoint } from '@/types/sdk';
import { accessTokenInputSchema, refreshTokenInputSchema, tokenResponseSchema, userInfoSchema } from './schema';
import type { AccessTokenInput, RefreshTokenInput, TokenResponse, UserInfo } from './schema';

/**
 * 三个凭据端点：访问令牌属于谁，以及获得新令牌的两条路。
 *
 * 它们说自己的词汇：`userinfo` 的信封里身份**直接**落在 `data` 下；token 端点答复裸 body、没有信封。两者互不替对方
 * 措辞：被拒的授权也是一份答复，只有调用方知道那意味着「问运维」还是「换个新令牌继续」。这正是裸答契约买到的东西——
 * 判定表对一个没有契约的 body 不下判，写着作废刷新令牌的 `400` 因此能活着交到 `token/manager.ts` 手里。框架的状态族
 * 同样不适用于这条契约，理由与那道窄判定都在 `@/client/error.ts` 的 `transportVerdict` 上。
 *
 * 三个端点都不带 Open API 要求的三件套头：`userinfo` 通过查询串被问起令牌，两个授权的身份是应用自己的 id 与 secret，
 * 它们声明在入参里而不是当作凭据——secret 续的是一个凭据，它自己不是，也从不进 store。
 *
 * 两个授权同址，只差 `grant_type`；这个字面量写在各自的适配器里，因为那正是区分两者唯一的东西。
 *
 * 见 https://docs.qq.com/open/document/app/oauth2/user_info.html、
 * https://docs.qq.com/open/document/app/oauth2/access_token.html
 * 与 https://docs.qq.com/open/document/app/oauth2/refresh_token.html
 */

/** 获取用户信息：凭据自己的身份。 */
export const userinfo: TDocEndpoint<undefined, UserInfo> = {
  operation: 'userinfo',
  responseSchema: userInfoSchema,

  requestAdaptor: (client) => {
    const url = new URL('/oauth/v2/userinfo', client.apiBase);
    url.searchParams.set('access_token', client.store.getAccessToken());
    return { url: url.href, init: { method: 'GET' } };
  },

  responseAdaptor: (_client, response) => {
    const envelope = getEnvelope<UserInfo>(response, 'userinfo');
    verifyEnvelope(envelope);
    return envelope.data;
  },
};

/** 获取 Token：把授权码换成凭据，答复是一段裸 body。 */
export const accessToken: TDocEndpoint<AccessTokenInput, TokenResponse> = {
  operation: 'accessToken',
  requestSchema: accessTokenInputSchema,
  responseSchema: tokenResponseSchema,

  requestAdaptor: (client, input) => {
    const url = new URL('/oauth/v2/token', client.apiBase);
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('client_secret', input.clientSecret);
    url.searchParams.set('grant_type', 'authorization_code');
    url.searchParams.set('code', input.code);
    url.searchParams.set('redirect_uri', input.redirectUri);
    return { url: url.href, init: { method: 'GET' } };
  },

  responseAdaptor: (_client, response) => getBareAnswer<TokenResponse>(response, 'accessToken'),
};

/** 刷新 Token：用刷新令牌换一枚新访问令牌，答复可能还捎回一枚新刷新令牌。 */
export const refreshToken: TDocEndpoint<RefreshTokenInput, TokenResponse> = {
  operation: 'refreshToken',
  requestSchema: refreshTokenInputSchema,
  responseSchema: tokenResponseSchema,

  requestAdaptor: (client, input) => {
    const url = new URL('/oauth/v2/token', client.apiBase);
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('client_secret', input.clientSecret);
    url.searchParams.set('grant_type', 'refresh_token');
    url.searchParams.set('refresh_token', input.refreshToken);
    return { url: url.href, init: { method: 'GET' } };
  },

  responseAdaptor: (_client, response) => getBareAnswer<TokenResponse>(response, 'refreshToken'),
};
