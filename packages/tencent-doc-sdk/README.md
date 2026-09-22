# tencent-doc-sdk

A client for the Tencent Docs Open API's smartsheet endpoints: which sub-sheets a document holds, the rows of one of them, and the credential both are read with.

It speaks the upstream's own vocabulary — the `{ ret, msg, data }` envelope, the payload keywords, the official response type names — and stops there. Each method is one endpoint and one round trip: no paging, no retries, no aggregating one answer across two calls. Pacing, metrics, logging and the meaning of a failure for anything downstream are left to whoever calls it.

## Use

```ts
import { createCredentialStore, createDocClient, createTokenManager } from 'tencent-doc-sdk';

const store = createCredentialStore({ accessToken: '…', clientId: '…', openId: '…', refreshToken: '…' });

const tokens = createTokenManager({
  apiBase: 'https://docs.qq.com',
  store,
  dispatch, // an undici Dispatcher, or a function asked for one
  clientSecret: '…', // only ever needed by the two token endpoints, and never part of a credential
});

const sheet = createDocClient({
  apiBase: 'https://docs.qq.com',
  coordinates: { fileId: '300000000$ExAmPlEfIlEiD', sheetId: 'tXXXXXX' },
  store,
});

const page = await sheet.getRecords({ offset: 0, limit: 100 });
const written = await sheet.addRecords([{ values: { 名称: [{ text: '甲', type: 'text' }] } }]);
await sheet.deleteRecords(written.records?.map((row) => row.recordID) ?? []);
```

Every call is one round trip. A call that failed is reported as failed and is not sent again, so a caller that wants a second attempt makes it knowing the quota was spent once already.

## The credential

A credential is held by a store and changed by a manager. The store is synchronous and knows no endpoints; the manager is async and knows the three that speak about a credential. Both are given the same store, so a token one of them obtains is the token the other sends on its next call, with nothing wired between them.

```ts
const store = createCredentialStore(configured);
const tokens = createTokenManager({ apiBase, store, dispatch, clientSecret });

const refreshed = await tokens.refreshToken(); // the credential as it now stands
await writeToWhereverItIsKept(store.get());

// …and back again on the next start, from wherever it was kept:
createCredentialStore(await readFromWhereverItWasKept());
```

`createCredentialStore({ accessToken, clientId, openId, refreshToken, expiresAt, issueAt })` holds those parts, and three of them may be unstated: an Open-Id is read off the access token's `sub` claim, a lifetime off its `exp` and an issue time off its `iat`, unless a value was said outright, which always wins. These are read off the token when it is written, not on every read; `set(record)` merges, so a part a record does not speak of keeps what was held. An access token that is replaced sheds a lifetime and issue time stated for the old one, but keeps a configured Open-Id — a refresh does not change who the credential belongs to.

The store only reads and writes state: `get()` answers with whatever is held — a part being absent is itself the answer, where a credential with no stated lifetime is not an expired one and one with no refresh token cannot be refreshed — and `set(record)` merges a partial over it. Which parts a given call cannot go out without is asserted at the call site, through `accessTokenOf`, `clientIdOf`, `openIdOf` and `refreshTokenOf`, each failing with `config` when that part is missing. A caller deciding whether to renew reads `get().expiresAt` directly.

`createTokenManager({ apiBase, store, dispatch, clientSecret, now })` sends the requests and writes what answers into the store. `getUserInfo()` reports whose access token the store holds and changes nothing; `fetchToken({ code, redirectUri })` and `refreshToken()` are the two grants — the same upstream endpoint, told apart by `grant_type` — and each returns the credential as it stands afterwards. `dispatch` is required: a manager never opens a connection of its own. `now` is the clock an answer's `expires_in` is folded onto, and the client secret is kept by the manager rather than the store, so it is in neither returned record.

Nothing here schedules a refresh, and nothing here decides that a reported Open-Id agrees with a configured one. An expired token is an `auth` failure on the next call.

## Errors

A failure is a `TencentDocsError` naming which of seven things went wrong, with everything the upstream said alongside it:

| `code`           | what it means                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `auth`           | the credential was refused, by HTTP 401/403 or by a business code that says so                      |
| `rate_limited`   | the upstream is throttling; `retryAfterSeconds` is what it stated, if anything                      |
| `bad_request`    | the request was refused, usually a business code in the `4xxxxx` range                              |
| `server`         | the upstream answered `5xx`                                                                         |
| `transport`      | there was no answer to read: refused, timed out, or a body that was not JSON                        |
| `invalid_answer` | the upstream said it succeeded with a body this library's response type has no words for            |
| `config`         | the call never became a request: no Open-Id to send, no refresh token, an address that is not a URL |

Alongside the code: `status`, `ret` and `msg` are what the upstream said, `path` is the address the call went to with its query string dropped, `cause` is whatever the failure was worded from, and `response` is the whole answer — status, headers, body — for whoever has to look at it again. `message` quotes the status and business code, and where a body is quoted it is `describeBody`'s masked, bounded form. `message` is what belongs on a log line or in an HTTP response; `response` is the undigested version, and a read's body is its whole sheet.

An error carries no HTTP status of its own: what a failure is _worth_ downstream is the caller's decision.

## Wrapping the calls

The library paces nothing, records nothing, and offers no hook to attach to. Whoever needs either of those things wraps the calls it makes.

Around the client is where a call can be waited for, counted, logged, refused or retried, because that is where its outcome is known:

```ts
import { TencentDocsError } from 'tencent-doc-sdk';
import { throttledQueue } from 'throttled-queue'; // https://github.com/shaunpersad/throttled-queue

const queue = throttledQueue({ maxPerInterval: 10, interval: 3000, evenlySpaced: true });

async function getRecords(page) {
  await queue(async () => {}); // one turn per start: the queue decides when this one may go out
  const startedAt = Date.now();
  try {
    return await sheet.getRecords(page);
  } catch (error) {
    // A TencentDocsError names which of seven things went wrong, and carries the answer it judged.
    throw error;
  } finally {
    observe(Date.now() - startedAt);
  }
}
```

The connection is the other seam: `transport` takes an undici `Dispatcher` — a pool, or a function asked per call — so a caller that hands in its own sees every request there. What it cannot see there is the envelope: a smartsheet call that failed answers `200` with a business code naming the reason, and the verdict only exists once the body has been read. Two of the OAuth calls carry their credential in the query string and every Open API call in an `Access-Token` header, so a request seen at either seam is holding a secret; the `path` on an error has its query string dropped for exactly that reason.

Given no `transport`, this library opens one pool per client and gives it `timeoutMs` for connect, headers and body — ten seconds unless the caller says otherwise.

## Testing without the upstream

Nothing is published for it: this package's own fake document lives in `test/testUtils`, alongside the tests that use it, and speaks the protocol only — no caller's columns, no caller's rules.

```ts
const upstream = testUpstream(); // a `DocClient` and a `TokenManager` sharing one store over the fake document
const { client, state } = upstream;

state.records = [rawRecord({ recordId: 'r00001' })];
state.readFailure = { status: 429, ret: 400007, msg: '请求数超过限制' };
state.networkFailures = 1; // the next call fails before any response exists
state.calls; // every intercepted request: method, url, body, headers
```

Its answers are the shapes measured against a real document, including the columns nobody reads, and they are pinned against the response types by `test/testUtils/fixtures.spec.ts`.

A caller of this package tests itself the same way it tests any dependency: at its own boundary, with whatever stand-in that boundary wants. Nothing here asks to be observed from the outside.

## Development

```sh
rush update           # once, after cloning
rushx build           # emit dist/
rushx format          # oxfmt
rushx lint            # oxlint
rushx typecheck       # tsc --noEmit
rushx test:unit       # vitest, over the fake document
rushx test:live        # vitest, over a real Tencent Docs document
```

`test:live` writes to a real document and spends its quota. It reads a credential from the file `OPS_ENV_PATH` names — `.env.test-live`, plus an ignored `.env.test-live.local` beside it — and skips every case unless that file names a document other than the example one. Without it, `rushx test` is offline.

## Endpoints

- 查询子表 — <https://docs.qq.com/open/document/app/openapi/v2/smartsheet/sheet/get_sheet.html>
- 查询记录 — <https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/get_records.html>
- 记录接口参数 — <https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/params.html>
- 获取用户信息 — <https://docs.qq.com/open/document/app/oauth2/user_info.html>
- 获取 Token — <https://docs.qq.com/open/document/app/oauth2/access_token.html>
- 刷新 Token — <https://docs.qq.com/open/document/app/oauth2/refresh_token.html>
