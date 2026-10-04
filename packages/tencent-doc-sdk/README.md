# tencent-doc-sdk

Tencent Docs Open API 的客户端：一张智能表有哪些子表、其中一张的行，以及两者读起来要用的凭据。

它按上游自己的词汇说话——`{ ret, msg, data }` 信封、载荷关键字、官方的响应类型名——到此为止。一次调用就是一个端点一次往返：不翻页、不重试、不把一份答复聚合到另一次调用上。节奏、指标、日志与一次失败对下游意味着什么，都归调用它的人。

## 用法

一个端点是声明：调用名、入参校验、把入参造成请求的适配器、把答复造成返回值的适配器。`createApi` 把它做成往返。

```ts
import { createApi, createCredentialStore, createTokenManager, endpoints } from 'tencent-doc-sdk';

const store = createCredentialStore({ accessToken: '…', clientId: '…', openId: '…', refreshToken: '…' });

const api = createApi({
  apiBase: 'https://docs.qq.com',
  store,
  params: { fileId: '300000000$ExAmPlEfIlEiD', sheetId: 'tXXXXXX' }, // 每次记录调用寻址的文档
  // transport, // 调用走的函数；不给就走 globalThis.fetch
});

const page = await api.call(endpoints.getRecords, { offset: 0, limit: 100 });
const written = await api.call(endpoints.addRecords, { records: [{ values: { 名称: [{ text: '甲', type: 'text' }] } }] });
await api.call(endpoints.deleteRecords, { recordIDs: written.records?.map((row) => row.recordID) ?? [] });
const sheets = await api.call(endpoints.getSheetList); // 没有自己的入参
```

凭据由 store 持有、由 manager 改动，两者共用同一份 store：

```ts
const tokens = createTokenManager({ apiBase, store, transport, clientSecret: '…' });

const refreshed = await tokens.refreshToken(); // 改动之后的凭据
await writeToWhereverItIsKept(store.get());
```

## 文档

- [endpoint](docs/endpoint.md)：端点的构成、适配器与八个端点的入参与线上形状。
- [client](docs/client.md)：`ApiOptions` 与 `Api`、一次调用怎么走、边界在哪。
- [错误处理](docs/error.md)：`TencentDocsError` 的字段与七个错误码。
- [校验](docs/validation.md)：schema 的文件划分，入参与出参各在哪里被校验。
- [凭据](docs/credential.md)：store 与 manager 的责任与生命周期。

## 运行

- `rushx build`：产出 `dist/`。
- `rushx test:unit`：vitest，对着 `test/testUtils/mockUpstream.ts` 的假文档；测试只讲协议，重构 `src/` 不动它们。
- `rushx test:live`：vitest，对着真实文档；读 `OPS_ENV_PATH` 点名的环境文件，未配置时整组跳过。
- `rushx lint` / `rushx format`：oxlint 与 oxfmt；`rushx typecheck`：`tsc --noEmit`。
