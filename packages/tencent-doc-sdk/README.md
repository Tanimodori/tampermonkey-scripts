# tencent-doc-sdk

腾讯文档 Open API 的客户端。它列出文档里的子表、读写其中一张子表的行，并管好这些调用要用的凭据。

一次调用是一次往返，失败统一是 `ApiError`，上游语义在端点的适配器里翻译。翻页、重试、节流与日志归调用方，本库不替它决定。调用链建在 [`api-sdk-framework`](../api-sdk-framework/README.md) 上。

## 能力

- 子表：列出文档里的子表。
- 记录：查询、新增、更新、删除一张子表的行。
- 凭据：问一枚访问令牌属于谁，以及用授权码或刷新令牌换新令牌。

## 用法

`createTDocClient` 收下地址、凭据与文档坐标，造出一个 client。端点按调用名从 `endpoints` 取，`client.call` 把它做成一次往返。

```ts
import { createTDocClient, createCredentialStore, endpoints } from 'tencent-doc-sdk';

const store = createCredentialStore({ accessToken: '…', clientId: '…', openId: '…', refreshToken: '…' });

const client = createTDocClient({
  apiBase: 'https://docs.qq.com',
  store,
  // 记录端点默认寻址的文档，调用自带的 params 覆盖它
  params: { fileId: '300000000$ExAmPlEfIlEiD', sheetId: 'tXXXXXX' },
  // transport, // 调用走的函数，不给就走 globalThis.fetch
});

const sheets = await client.call(endpoints.getSheetList); // 没有自己的入参
const page = await client.call(endpoints.getRecords, { offset: 0, limit: 100 });
await client.call(endpoints.addRecords, { records: [{ values: { 名称: [{ text: '甲', type: 'text' }] } }] });
await client.call(endpoints.updateRecords, { records: [{ recordID: 'rXXXX', values: { 名称: [{ text: '乙', type: 'text' }] } }] });
await client.call(endpoints.deleteRecords, { recordIDs: page.records?.map((row) => row.recordID) ?? [] });
```

`transport` 是唯一一条接缝，类型为仓库共用的 `WebFetcher`。

凭据由 store 持有、由 manager 改动，两者共用同一份 store。manager 管三个说凭据的端点，`clientSecret` 留在 manager 手里，不进 store。

```ts
import { createTokenManager } from 'tencent-doc-sdk';

const tokens = createTokenManager({ apiBase: 'https://docs.qq.com', store, clientSecret: '…' });

await tokens.getUserInfo(); // 问 store 手里这枚访问令牌是谁的
const refreshed = await tokens.refreshToken(); // 写入 store，并返回现持有的凭据
await tokens.fetchToken({ code: '…', redirectUri: '…' });

// 凭据的持久化由调用方负责，store.get() 是要写出去的快照，store.set() 是载回来的方式。
```

## 文档

- [endpoint](docs/endpoint.md)：端点契约与八个端点的入参、请求与答复。
- [client](docs/client.md)：`TDocClientOptions` 与 `TDocClient`、一次调用怎么走、边界在哪。
- [错误处理](docs/error.md)：`ApiError` 的字段与本库使用的八个错误码。
- [校验](docs/validation.md)：schema 的文件划分，入参与出参各在哪里被校验。
- [凭据](docs/credential.md)：store 与 manager 的责任与生命周期。

## 运行

- `rushx build`：产出 `dist/`。
- `rushx test:unit`：vitest，对着 `test/testUtils/mockUpstream.ts` 的假文档，测试只讲协议，重构 `src/` 不动它们。
- `rushx test:live`：vitest，对着真实文档，读 `OPS_ENV_PATH` 点名的环境文件，未配置时整组跳过。
- `rushx lint` / `rushx format`：oxlint 与 oxfmt。
- `rushx typecheck`：`tsc -b`。
