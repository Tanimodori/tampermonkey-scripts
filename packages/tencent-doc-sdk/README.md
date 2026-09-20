# tencent-doc-sdk

A client for the Tencent Docs Open API's smartsheet endpoints: which sub-sheets a document holds, the rows of one of them, and the credential both are read with.

It speaks the upstream's own vocabulary — the `{ ret, msg, data }` envelope, the payload keywords, the official response type names — and stops there. Pacing, retries, metrics, logging and the meaning of a failure for anything downstream are left to whoever calls it.

## Use

```ts
import { createDocClient, createTokenManager } from 'tencent-doc-sdk';

const tokens = createTokenManager({
  apiBase: 'https://docs.qq.com',
  initial: { accessToken: '…', clientId: '…', openId: '…', refreshToken: '…' },
  clientSecret: '…', // only ever needed by refresh(), and never persisted
});

const sheet = createDocClient({
  apiBase: 'https://docs.qq.com',
  coordinates: { fileId: '300000000$ExAmPlEfIlEiD', sheetId: 'tXXXXXX' },
  tokens,
});

const page = await sheet.getRecords({ offset: 0, limit: 100 });
const written = await sheet.addRecords([{ values: { 区服: [{ text: '鸟', type: 'text' }] } }]);
await sheet.deleteRecords(written.records?.map((row) => row.recordID) ?? []);
```

Every call is one round trip. A call that failed is reported as failed and is not sent again, so a caller that wants a second attempt makes it knowing the quota was spent once already.

## The credential

`createTokenManager` holds the access token, the client it was issued to, the Open-Id it belongs to and the refresh token that can replace it, and knows the two endpoints that speak about them: `validate()` asks the upstream whose token this is, and `refresh()` exchanges a refresh token for a new access token.

A refreshed credential outlives the process it was obtained in when the caller hands in a `store`:

```ts
createTokenManager({
  apiBase,
  initial: configured,
  clientSecret,
  store: {
    async load() {
      return readFromWhereverItWasKept();
    },
    async save(record) {
      await writeToWhereverItIsKept(record); // only the fields it was given
    },
  },
});
```

Given no store, the credential lives in this process only. `hydrate()` prefers a stored credential over the configured one while its access token is still usable; the client secret is never part of a stored record.

Nothing here schedules a refresh. An expired token is an `auth` failure on the next call.

## Errors

A failure is a `TencentDocsError` naming which of seven things went wrong, with everything the upstream said alongside it:

| `code`           | what it means                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `auth`           | the credential was refused, by HTTP 401/403 or by a business code that says so           |
| `rate_limited`   | the upstream is throttling; `retryAfterSeconds` is what it stated, if anything           |
| `bad_request`    | the request was refused, usually a business code in the `4xxxxx` range                   |
| `server`         | the upstream answered `5xx`                                                              |
| `transport`      | there was no answer to read: refused, timed out, or a body that was not JSON             |
| `invalid_answer` | the upstream said it succeeded with a body this library's response type has no words for |
| `config`         | the call cannot be made as configured: no Open-Id to send, no refresh token to exchange  |

`message` quotes the upstream's status and business code, and where a body is quoted it is `describeBody`'s masked, bounded form. An error carries no HTTP status of its own: what a failure is _worth_ downstream is the caller's decision.

## Watching the calls

The library records nothing. `hooks` is where a caller's counters, histograms and log lines attach:

```ts
createDocClient({
  apiBase,
  coordinates,
  tokens,
  hooks: {
    onCall(descriptor, outcome) {
      // { operation, method, path } and one of answered / failed / unsent, with durationMs
    },
    onParseFailure(descriptor, error) {
      // the bytes arrived and said `ret: 0`; they were not the shape the endpoint promises
    },
  },
});
```

`descriptor.path` never carries a query string, and the `reason` of an unsent call is worded without the URL the transport failed on — two of the upstream's calls carry a credential in their query string, and a transport error quotes it in full.

`dispatch` is the other half of the same idea: a caller that paces its outbound calls passes a gate, and the library wraps one logical call in it.

```ts
import { throttledQueue } from 'throttled-queue';

const queue = throttledQueue({ maxPerInterval: 10, interval: 3000, evenlySpaced: true });
createDocClient({ /* … */ dispatch: (_call, next) => queue(next) });
```

Given nothing, calls are sent as they are asked for.

## Testing without the upstream

`tencent-doc-sdk/testing` is a programmable fake document, on undici's `MockAgent`:

```ts
import { setupTencentDocsMock } from 'tencent-doc-sdk/testing';

const docs = setupTencentDocsMock({ records: [rawRecord({ recordId: 'r00001' })] });
const client = createDocClient({ apiBase, coordinates, tokens, transport: docs.agent });

docs.state.readFailure = { status: 429, ret: 400007, msg: '请求数超过限制' };
docs.state.networkFailures = 1; // the next call fails before any response exists
docs.state.calls; // every intercepted request: method, url, body, headers
```

Its answers are the shapes measured against a real document, including the columns nobody reads, and they are pinned against the response types by `test/fixtures.spec.ts`.

## Development

```sh
rush update           # once, after cloning
rushx build           # emit dist/
rushx format          # oxfmt
rushx lint            # oxlint
rushx typecheck       # tsc --noEmit
rushx test:unit       # vitest, over the fake document
rushx test:api        # vitest, over a real Tencent Docs document
```

`test:api` writes to a real document and spends its quota. It reads a credential from the file `OPS_ENV_PATH` names — `.env.test-api`, plus an ignored `.env.test-api.local` beside it — and skips every case unless that file names a document other than the example one. Without it, `rushx test` is offline.

## Endpoints

- 查询子表 — <https://docs.qq.com/open/document/app/openapi/v2/smartsheet/sheet/get_sheet.html>
- 查询记录 — <https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/get_records.html>
- 记录接口参数 — <https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/params.html>
- 获取用户信息 — <https://docs.qq.com/open/document/app/oauth2/user_info.html>
- 获取 Token — <https://docs.qq.com/open/document/app/oauth2/access_token.html>
- 刷新 Token — <https://docs.qq.com/open/document/app/oauth2/refresh_token.html>
