# 凭据

一份凭据由 store 持有、由 manager 改动。store 是同步的、不认识端点；manager 是异步的、认识说凭据的三个端点。两者共用同一份 store，因此一方拿到的令牌就是另一方下一次调用带的令牌，不需要谁被接到谁上。

## Store

`createCredentialStore(record?)` 持有访问令牌、刷新令牌、Open-Id、client id 与两个时刻。每个字段都可选，因为「现在持有什么」允许某个部分还没被说过。

```ts
export interface CredentialStore {
  /** 此刻持有的东西；缺席本身是答案，不抛 */
  get(): CredentialRecord;
  /** 把一份局部合并在持有的内容上 */
  set(record: Partial<CredentialRecord>): void;
  /** 三件套头；缺任何一个都是 BAD_INPUT */
  getAuthHeaders(): { 'Access-Token': string; 'Client-Id': string; 'Open-Id': string };
  /** userinfo 要问的那枚令牌；没有就是 BAD_INPUT */
  getAccessToken(): string;
  /** 两个授权点名应用的 client id；没有就是 BAD_INPUT */
  getClientId(): string;
  /** 让刷新成为可能的刷新令牌；没有就是 BAD_INPUT */
  getRefreshToken(): string;
}
```

- `get()` 答「现在持有什么」，什么都不抛；决定要不要续期、下次启动写出去什么，问的是它。
- 四个读取答「这次调用出不出得去」，缺失按 `BAD_INPUT` 报出来，而不是交回 `undefined`；发送问的是它们。
- 令牌能替自己说的部分（Open-Id 来自 `sub`、到期来自 `exp`、签发时间来自 `iat`）在令牌被写进来的那一刻解析好；明说的值压过声明，且明说的 Open-Id 穿过每一次刷新。
- `set` 是合并：记录没说的字段保持原值。访问令牌被替换时，为旧令牌说的到期与签发时间随它脱掉；换上的令牌自己说，或不说。
- 凭据进出这个进程由调用方负责：`store.get()` 是写出去的那份快照，`set(record)` 是载回来的方式。

## Manager

```ts
export interface TokenManager {
  /** 获取用户信息：问 store 手里这枚访问令牌是谁的 */
  getUserInfo(): Promise<UserInfo>;
  /** 获取 Token：兑换授权码，写下答复，返回现持有的凭据 */
  fetchToken(input: { code: string; redirectUri: string }): Promise<CredentialRecord>;
  /** 刷新 Token：兑换刷新令牌，写下答复，返回现持有的凭据 */
  refreshToken(): Promise<CredentialRecord>;
}
```

- manager 只做异步那一半：问上游，把答复写进给它的 store；`clientSecret` 留在 manager 手里，不进 store，也不进任何返回的记录。
- 不安排刷新，不判断上游报的 Open-Id 是否与配置一致；配置一个过期令牌意味着下一次调用报 `UNAUTHORIZED`。
- 两次授权共用一条地址，只差 `grant_type`；这个字面量写在各自的适配器里。
- 被拒的授权是一份答复而不是 `UNAUTHORIZED`：只有调用方知道「问运维」还是「换新令牌继续」，措辞归它——`fetchToken`/`refreshToken` 会把没有访问令牌的答复说成 `UNAUTHORIZED` 并引用脱敏后的 body。框架的状态族不适用于这两个端点的裸答契约：上游用 400 答一枚被拒的凭据，那条答复照旧活着交到 manager 手里。404 是例外：地址不对时那份答复根本没到，两条契约都判 `ENDPOINT_NOT_FOUND`。
