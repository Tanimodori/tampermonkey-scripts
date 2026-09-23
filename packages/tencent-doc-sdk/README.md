# tencent-doc-sdk

A client for the Tencent Docs Open API's smartsheet endpoints: which sub-sheets a document holds, the rows of one of them, and the credential both are read with.

It speaks the upstream's own vocabulary — the `{ ret, msg, data }` envelope, the payload keywords, the official response type names — and stops there. Each call is one endpoint and one round trip: no paging, no retries, no aggregating one answer across two calls. Pacing, metrics, logging and the meaning of a failure for anything downstream are left to whoever calls it.

## Use

An endpoint is a declaration — the method, the address, the schema of each part, and the schema of the answer — and one function makes the call it describes.

```ts
import { createApi, createCredentialStore, createTokenManager, endpoints } from 'tencent-doc-sdk';

const store = createCredentialStore({ accessToken: '…', clientId: '…', openId: '…', refreshToken: '…' });

const tokens = createTokenManager({
  apiBase: 'https://docs.qq.com',
  store,
  transport, // the fetch a call goes through; `globalThis.fetch` when omitted
  clientSecret: '…', // only ever needed by the two token endpoints, and never part of a credential
});

const api = createApi({
  apiBase: 'https://docs.qq.com',
  params: { fileId: '300000000$ExAmPlEfIlEiD', sheetId: 'tXXXXXX' }, // the document every record call addresses
  store,
});

const page = await api.call(endpoints.getRecords, { body: { getRecords: { offset: 0, limit: 100 } } });
const written = await api.call(endpoints.addRecords, { body: { addRecords: { records: [{ values: { 名称: [{ text: '甲', type: 'text' }] } }] } } });
await api.call(endpoints.deleteRecords, { body: { deleteRecords: { recordIDs: written.records?.map((row) => row.recordID) ?? [] } } });
const sheets = await api.call(endpoints.getSheetList); // no body, no params of its own
```

The `body` is what goes on the wire, keyword wrapper and all: the same object the endpoint's schema checks before a byte is sent, so nothing this library assembles can differ from what it validated. An endpoint that declares no `params` for itself still addresses a document, because `createApi` holds the coordinates and passes them to every call that needs them — a call's own `params` override them, which is what lets one client read a sibling sheet.

Every call is one round trip. A call that failed is reported as failed and is not sent again, so a caller that wants a second attempt makes it knowing the quota was spent once already.

## The credential

A credential is held by a store and changed by a manager. The store is synchronous and knows no endpoints; the manager is async and knows the three that speak about a credential. Both are given the same store, so a token one of them obtains is the token the other sends on its next call, with nothing wired between them.

```ts
const store = createCredentialStore(configured);
const tokens = createTokenManager({ apiBase, store, transport, clientSecret });

const refreshed = await tokens.refreshToken(); // the credential as it now stands
await writeToWhereverItIsKept(store.get());

// …and back again on the next start, from wherever it was kept:
createCredentialStore(await readFromWhereverItWasKept());
```

`createCredentialStore({ accessToken, clientId, openId, refreshToken, expiresAt, issueAt })` holds those parts, and three of them may be unstated: an Open-Id is read off the access token's `sub` claim, a lifetime off its `exp` and an issue time off its `iat`, unless a value was said outright, which always wins. These are read off the token when it is written, not on every read; `set(record)` merges, so a part a record does not speak of keeps what was held. An access token that is replaced sheds a lifetime and issue time stated for the old one, but keeps a configured Open-Id — a refresh does not change who the credential belongs to.

Two kinds of question are asked of a store, and they are asked apart. `get()` answers "what is held right now" and never throws — a part being absent is itself the answer, where a credential with no stated lifetime is not an expired one and one with no refresh token cannot be refreshed — and `set(record)` merges a partial over it. The four readers answer "can this call go out at all": `getAuthHeaders()` is the `Access-Token`/`Client-Id`/`Open-Id` three-piece every Open API call carries, `getAccessToken()` is the token `userinfo` is asked about, `getClientId()` is the application both grants name themselves by, and `getRefreshToken()` is what makes a refresh possible; each fails with `config` rather than handing back `undefined` to be noticed later. There is no `getOpenId()`: outside that header the Open-Id is sent nowhere, and a caller who only wants to look at it reads `get().openId`. Deciding whether to renew is therefore a `get()` question, and sending is a reader's.

`createTokenManager({ apiBase, store, transport, clientSecret, now })` sends the requests and writes what answers into the store. `getUserInfo()` reports whose access token the store holds and changes nothing; `fetchToken({ code, redirectUri })` and `refreshToken()` are the two grants — the same upstream endpoint, told apart by `grant_type` — and each returns the credential as it stands afterwards. `transport` is the fetch a call goes through, the platform's own when none is given. `now` is the clock an answer's `expires_in` is folded onto, and the client secret is kept by the manager rather than the store, so it is in neither returned record.

Nothing here schedules a refresh, and nothing here decides that a reported Open-Id agrees with a configured one. An expired token is an `auth` failure on the next call.

## Errors

A failure is a `TencentDocsError` naming which of seven things went wrong, with everything the upstream said alongside it:

| `code`           | what it means                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `auth`           | the credential was refused, by HTTP 401/403 or by a business code that says so                                                      |
| `rate_limited`   | the upstream is throttling; `retryAfterSeconds` is what it stated, if anything                                                      |
| `bad_request`    | the request was refused, usually a business code in the `4xxxxx` range                                                              |
| `server`         | the upstream answered `5xx`                                                                                                         |
| `transport`      | there was no answer to read: refused, timed out, or a body that was not JSON                                                        |
| `invalid_answer` | the upstream said it succeeded with a body this library's response type has no words for                                            |
| `config`         | the call never became a request: arguments its endpoint rejects, no Open-Id to send, no refresh token, an address that is not a URL |

`config` is the one code settled without asking the upstream anything. A call whose arguments its endpoint does not accept — a negative `offset`, a `limit` over the page maximum, a write of no rows — is refused before a request is assembled, so it costs no quota and carries no `status`, `ret` or `response`; the message names the field, which points at the caller's own code rather than at the request. TypeScript rejects most of these at the call site already; the schema is there for the callers it cannot reach.

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
    return await api.call(endpoints.getRecords, { body: { getRecords: page } });
  } catch (error) {
    // A TencentDocsError names which of seven things went wrong, and carries the answer it judged.
    throw error;
  } finally {
    observe(Date.now() - startedAt);
  }
}
```

The connection is the other seam: `transport` takes a `Fetcher` — `(url, init) => Promise<Response>`, the shape [`@apollo/utils.fetcher`](https://github.com/apollographql/utils) describes and this package re-exports — so a caller that hands in its own sees every request there, and one whose pool is rebuilt underneath reads the current one from inside its own fetch. What it cannot see there is the envelope: a smartsheet call that failed answers `200` with a business code naming the reason, and the verdict only exists once the body has been read. Two of the OAuth calls carry their credential in the query string and every Open API call in an `Access-Token` header, so a request seen at either seam is holding a secret; the `path` on an error has its query string dropped for exactly that reason.

Given no `transport`, calls go out on `globalThis.fetch`. The library registers no timeout of its own and never sets a `signal`: how long a call may hang is whatever the fetch was built to allow — a pool's timeouts, or an `AbortSignal` the caller passes — and a fetch that bounds nothing leaves its caller waiting on the upstream.

## Testing without the upstream

Nothing is published for it: this package's own fake document lives in `test/testUtils`, alongside the tests that use it, and speaks the protocol only — no caller's columns, no caller's rules.

```ts
const upstream = testUpstream(); // an `Api` and a `TokenManager` sharing one store over the fake document
const { api, state } = upstream;

state.records = [rawRecord({ recordId: 'r00001' })];
state.readFailure = { status: 429, ret: 400007, msg: '请求数超过限制' };
state.networkFailures = 1; // the next call fails before any response exists
state.calls; // every intercepted request: method, url, body, headers
```

Its answers are the shapes measured against a real document, including the columns nobody reads, and they are pinned against the response types by `test/testUtils/fixtures.spec.ts`. Because the fake stands in for the upstream rather than for this library, a refactor that only moves code around inside `src/` leaves both it and those fixtures untouched — which is what makes them worth reading as the evidence that the wire format did not move either.

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
