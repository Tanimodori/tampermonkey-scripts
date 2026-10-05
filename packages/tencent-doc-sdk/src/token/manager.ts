import { ApiError, ApiErrorCodes } from 'api-sdk-framework';
import type { WebFetcher } from 'universal-fetch-type';
import { createTDocClient } from '@/client';
import { endpoints } from '@/endpoints';
import type { TokenResponse, UserInfo } from '@/endpoints/schema';
import { describeBody } from '@/error';
import type { CredentialRecord, CredentialStore } from './store';

/**
 * 说凭据的三件事的三个端点：这枚令牌属于谁，以及获得新令牌的两条路。
 *
 * 凭据的这一半是异步的，也只做异步的事：问上游，把上游答的写进给它的 store。凭据是什么、哪一部分可以不知道、
 * 进程之间把它放哪，是 `token/store.ts` 的事——store 是注入的而不是在这里造的，正是为了让发文档调用的 client 和兑换
 * 令牌的这个管理同一份凭据：这里刷新的令牌就是下一次读取要带的令牌，不需要谁被接到那次兑换上。
 *
 * 三次调用都走一张普通的 `TDocClient`，与别的端点一样。这里加的是两件不是调用的事：一次授权为哪个应用而做，以及一份答复
 * 对凭据意味着什么——上游把授权拼成 `client_id` 与 `redirect_uri`，本库叫它们 `clientId` 与 `redirectUri`，
 * 这层翻译跟着占凭据的人走，授权端点自己的入参已经收下调用方形状。
 *
 * 这里不判一枚坏凭据意味着什么。不会安排刷新，不会重试，`getUserInfo()` 报回来的身份也只是交出去：Open-Id 是否
 * 与令牌一致、过期令牌值不值得报警，都是关于调用方自己配置的判断。
 */

/** 管理这三次调用所需要的东西，不多不少。 */
export interface TokenManagerOptions {
  readonly apiBase: string;
  /** 每次调用都带着、每份答复都写回的凭据。 */
  readonly store: CredentialStore;
  /** 调用走的函数，因此也是它连接与超时的所有者。默认 `globalThis.fetch`。 */
  readonly transport?: WebFetcher | undefined;
  /** 两个 token 授权都要，且从不属于它续的那份凭据。 */
  readonly clientSecret?: string | undefined;
  /** `expires_in` 折算到哪个时钟上。默认墙上时间。 */
  readonly now?: () => number;
}

export interface TokenManager {
  /** 获取用户信息：问 store 手里这枚访问令牌是谁的。 */
  getUserInfo(): Promise<UserInfo>;
  /** 获取 Token：兑换一个授权码，收下答复，返回现在持有的凭据。 */
  fetchToken(input: { readonly code: string; readonly redirectUri: string }): Promise<CredentialRecord>;
  /** 刷新 Token：兑换 store 里的刷新令牌，收下答复，返回现在持有的凭据。 */
  refreshToken(): Promise<CredentialRecord>;
}

/** 在一份共享凭据上装配一个管理。 */
export function createTokenManager(options: TokenManagerOptions): TokenManager {
  const api = createTDocClient({ apiBase: options.apiBase, store: options.store, transport: options.transport });
  const store = options.store;
  const now = options.now ?? Date.now;

  /** client secret 留在管理里而不是 store：它续的是一个凭据，它自己不是。 */
  function grant(): { clientId: string; clientSecret: string } {
    const secret = options.clientSecret;
    if (secret === undefined || secret.length === 0) {
      throw new ApiError({ errorCode: ApiErrorCodes.BAD_INPUT, message: 'The token endpoints need a client secret, and none was configured' });
    }
    return { clientId: store.getClientId(), clientSecret: secret };
  }

  function hold(body: TokenResponse): CredentialRecord {
    const accessToken = body.access_token;
    if (accessToken === undefined || accessToken.length === 0) {
      throw new ApiError({ errorCode: ApiErrorCodes.UNAUTHORIZED, message: `Tencent Docs refused to exchange the credential (body: ${describeBody(body)})` });
    }

    const expiresIn = body.expires_in;
    store.set({
      accessToken,
      openId: body.user_id,
      // 有些流程会捎回一枚轮换过的刷新令牌；收下它，下一次刷新才有可能。
      refreshToken: body.refresh_token,
      // 答复没说的时限是令牌自己的事：store 从 `exp` 里读。
      expiresAt: expiresIn !== undefined && expiresIn > 0 ? now() + Math.round(expiresIn * 1000) : undefined,
    });
    return store.get();
  }

  // 每个方法都是 `async`，凭据不足以成行时是 rejection 而不是扔在碰巧发问的那个人身上：读 store 与 secret 是每
  // 一次最先做的事。
  return {
    getUserInfo: async () => api.call(endpoints.userinfo),
    fetchToken: async ({ code, redirectUri }) => hold(await api.call(endpoints.accessToken, { ...grant(), code, redirectUri })),
    refreshToken: async () => hold(await api.call(endpoints.refreshToken, { ...grant(), refreshToken: store.getRefreshToken() })),
  };
}
