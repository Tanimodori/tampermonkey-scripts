# 凭据

一份凭据由 store 持有、由 manager 改动。store 是同步的、不认识端点，manager 是异步的、认识说凭据的三个端点。两者共用同一份 store，因此一方拿到的令牌就是另一方下一次调用带的令牌。

## Store

`createCredentialStore(record?)` 是凭据的同步持有者，`get()` 交出此刻持有的内容，`set()` 把一份局部合并上去。

```ts
export interface CredentialRecord {
  readonly accessToken?: string | undefined;
  readonly refreshToken?: string | undefined;
  readonly openId?: string | undefined;
  readonly clientId?: string | undefined;
  /** accessToken 失效的时刻，epoch 毫秒 */
  readonly expiresAt?: number | undefined;
  /** accessToken 被签发的时刻，epoch 毫秒 */
  readonly issueAt?: number | undefined;
}

export interface CredentialStore {
  /** 此刻持有的东西，缺席本身是答案，不抛 */
  get(): CredentialRecord;
  /** 把一份局部合并在持有的内容上 */
  set(record: Partial<CredentialRecord>): void;
  /** 三件套头，缺任何一个都是 BAD_INPUT */
  getAuthHeaders(): { 'Access-Token': string; 'Client-Id': string; 'Open-Id': string };
  /** userinfo 要问的那枚令牌，没有就是 BAD_INPUT */
  getAccessToken(): string;
  /** 两个授权点名应用的 client id，没有就是 BAD_INPUT */
  getClientId(): string;
  /** 让刷新成为可能的刷新令牌，没有就是 BAD_INPUT */
  getRefreshToken(): string;
}
```

- `get()` 答「现在持有什么」，什么都不抛，要不要续期、下次启动写出去什么问的是它。
- `getAuthHeaders`、`getAccessToken`、`getClientId`、`getRefreshToken` 答「这次调用出不出得去」，缺件按 `BAD_INPUT` 报出来，而不是交回 `undefined`，发送问的是它们。
- `set` 是合并，记录没说的字段保持原值。
- 令牌能替自己说的部分在写进来的那一刻解析好，Open-Id 来自 `sub`、到期来自 `exp`、签发时间来自 `iat`，明说的值压过声明。访问令牌被替换时，令牌派生的到期与签发时间随它重算。
- 凭据的持久化由调用方负责，`get()` 是要写出去的快照，`set(record)` 是载回来的方式。`clientSecret` 不在记录里，它从不离开被配置进来的环境。

## Manager

manager 只做异步那一半，问上游并把答复写进给它的 store。三次调用都走一张普通的 `TDocClient`，与别的端点一样。

```ts
export interface TokenManagerOptions {
  /** 调用发往的地址 */
  readonly apiBase: string;
  /** 每次调用都带着、每份答复都写回的凭据 */
  readonly store: CredentialStore;
  /** 调用走的函数，因此也是它连接与超时的所有者，默认 globalThis.fetch */
  readonly transport?: WebFetcher | undefined;
  /** 两个 token 授权都要，且从不属于它续的那份凭据 */
  readonly clientSecret?: string | undefined;
  /** expires_in 折算到哪个时钟上，默认墙上时间 */
  readonly now?: () => number;
}

export interface TokenManager {
  /** 问 store 手里这枚访问令牌是谁的 */
  getUserInfo(): Promise<UserInfo>;
  /** 兑换一个授权码，写下答复，返回现持有的凭据 */
  fetchToken(input: { code: string; redirectUri: string }): Promise<CredentialRecord>;
  /** 兑换 store 里的刷新令牌，写下答复，返回现持有的凭据 */
  refreshToken(): Promise<CredentialRecord>;
}
```

- `clientSecret` 留在 manager 手里，不进 store，也不进任何返回的记录。
- 两个授权只差 `grant_type`，这个字面量写在各自的适配器里。
- 不安排刷新，也不判断上游报的 Open-Id 是否与配置一致。配置一个过期令牌意味着下一次调用报 `UNAUTHORIZED`。
- 兑换答复里没有访问令牌时，`fetchToken` 与 `refreshToken` 抛 `UNAUTHORIZED` 并引用脱敏后的 body。上游用 400 答一枚被拒的凭据，那条答复照旧交到调用方手里措辞。

## 令牌

`parseJwtToken(token)` 把一枚令牌切成 `Header.Payload.Signature` 三段并解码两段 JSON，不是可解码三段令牌的东西得到 `undefined`，签名不验证。`readAccessTokenClaims(token)` 交出载荷，`readAccessTokenExpiresAt(token)` 把 `exp` 折成 epoch 毫秒。给只持有一枚裸令牌、不经过 store 的调用方。
