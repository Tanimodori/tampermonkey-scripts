import type { Fetcher, FetcherRequestInit } from '@apollo/utils.fetcher';
import type { z } from 'zod';
import type { AnyEndpoint, CallArgs, OutputOf } from '@/endpoint';
import type { DocCoordinates, PathParams } from '@/path';
import { buildPath } from '@/path';
import type { CredentialStore } from '@/token/store';
import { classifyResponse, cannotAssemble, inputRejected, invalidAnswer, transportFailure } from '@/validation/classify';
import type { CallShape, ResponseHeaders } from '@/validation/classify';
import { answerHeaderSchema } from '@/validation/schemas';

/**
 * One call, made: assembled from what its endpoint declares, sent, read, judged.
 *
 * This is where a call's cost is paid, and it owns the whole of the paying. An endpoint says what leaves
 * (`method`, `path`, `params`, `query`, `body`) and what arriving would mean (`response`); everything a
 * caller would otherwise have to remember per call — the credential, the media types, which answer carries
 * the envelope, which field of a good answer is the one worth returning — happens here once, for every
 * endpoint, in the same order.
 *
 * That order is the one that fails cheapest first. The caller's own arguments are checked before anything
 * is built — `params`, `query`, and the `body` too, which is written out from the value the schema
 * accepted rather than from the one it was handed — so a negative `offset` never becomes a request. The
 * address is settled next, so a misconfigured `apiBase` never reaches the transport. Only then is the
 * credential read, because a call that was never going to leave should not report what it would have
 * carried.
 *
 * There is no retry here, and no timeout, and that is the whole design: one endpoint is one round trip. A
 * caller that wants a second attempt makes it, knowing that a write which failed may already have landed
 * and that the upstream's quota is spent either way. Whoever owns the connection does so in the `Fetcher`
 * handed to `createApi`, or around the call — a library that translates the upstream's endpoints one for
 * one has no opinion about what those calls are worth to anybody.
 */

/** What every way of reaching the upstream needs: where it is, whose credential to carry, how to get there. */
export interface ApiOptions {
  /** Where the calls go: `https://docs.qq.com`, or whatever stands in for it under a test. */
  readonly apiBase: string;
  /** The credential every `auth: 'headers'` and `auth: 'query-token'` call is made with. */
  readonly store: CredentialStore;
  /**
   * The coordinates the document endpoints address by, so a caller states its document once instead of
   * per call. A call's own `params` win over these, which is what lets one client read a sibling sheet.
   */
  readonly params?: DocCoordinates | undefined;
  /**
   * The one seam a caller has: the function a call is sent through, so whoever owns the connection — a
   * keep-alive pool, a proxy, a mock, a retry or a refusal — owns it there rather than here. Given
   * nothing, calls go out on `globalThis.fetch`.
   *
   * Timeouts come along with it: this library never sets a `signal`, so how long a call may hang is
   * whatever the fetcher was built to allow. A caller whose connection is rebuilt underneath can read the
   * current one from inside its own fetcher, which is why there is no "a function asked per call" form
   * here — a fetcher already is one.
   */
  readonly transport?: Fetcher | undefined;
}

/** The document, as a caller works with it: every endpoint, called the same way. */
export interface Api {
  /**
   * Makes one call and answers with what the endpoint's `response` selected out of the upstream's answer.
   *
   * `input` is required exactly when the endpoint declares a part for it, and rejects one it does not.
   */
  call<E extends AnyEndpoint>(endpoint: E, ...input: CallArgs<E>): Promise<OutputOf<E>>;
}

/** The parts of a call a caller may supply, before the endpoint's own schemas have judged them. */
interface CallParts {
  readonly params?: PathParams | undefined;
  readonly query?: PathParams | undefined;
  readonly body?: unknown;
}

/** Builds a client that calls the upstream's endpoints over one credential store. */
export function createApi(options: ApiOptions): Api {
  const transport = options.transport ?? defaultFetcher;
  const { apiBase, store } = options;

  return { call: (endpoint, ...input) => call(endpoint, input[0] as CallParts | undefined) };

  /**
   * One round trip, judged and read: the answer as the endpoint says to take it, or the `TencentDocsError`
   * naming which thing went wrong.
   *
   * Three ways an answer is not usable, and each is worded where it is discovered: nothing arrived (or
   * nothing readable) is a `transport` failure, an arrived answer the envelope calls a failure is whatever
   * `classifyResponse` says it is, and an answer the endpoint's own type has no words for is an
   * `invalid_answer`. A call whose arguments, address or payload could not be settled is a `config`
   * failure and never reaches the transport at all.
   */
  async function call<E extends AnyEndpoint>(endpoint: E, parts: CallParts | undefined): Promise<OutputOf<E>> {
    const { operation, response } = endpoint;
    const params = check(endpoint.params, { ...options.params, ...parts?.params }, operation);
    const query = check(endpoint.query, parts?.query, operation);
    const body = sentBody(endpoint, parts?.body);
    const url = address(endpoint, params, query);

    // The path without its query string, twice over: `error.path` and the message both report a call by
    // it, and three of the OAuth calls carry a credential in exactly that query. `URL#pathname` never
    // includes one.
    const { pathname: path } = url;
    const shape: CallShape = { operation, path, envelope: response.envelope };
    const requestHeaders = headersFor(endpoint);
    const init: FetcherRequestInit = {
      method: endpoint.method,
      ...(requestHeaders === undefined ? {} : { headers: requestHeaders }),
      ...(body === undefined ? {} : { body }),
    };

    let status: number;
    let headers: ResponseHeaders;
    let answer: unknown;
    try {
      const upstream = await transport(url.href, init);
      status = upstream.status;
      headers = Object.fromEntries(upstream.headers);
      answer = await upstream.json();
    } catch (error) {
      // Three ways to get here and no answer: the upstream never replied, its body never finished arriving,
      // or what arrived was not JSON at all. None of them is classified — there is nothing to read a verdict
      // out of — so this failure is worded from the transport's own report, which keeps the original as a
      // cause instead of quoting it: that message spells out the URL it failed on, query string included.
      throw transportFailure(error, `${url.origin}${path}`, path);
    }

    const header = answerHeaderSchema.safeParse(answer);
    const failure = classifyResponse({ status, headers, body: answer, ...(header.success ? header.data : {}) }, shape);
    if (failure !== undefined) throw failure;

    const parsed = response.schema.safeParse(answer);
    if (!parsed.success) throw invalidAnswer(shape, parsed.error, { status, headers, body: answer });

    // The one place the endpoint's declared output is not the whole answer. `unwrap` was typed against
    // `response.schema`'s output when the endpoint was declared, and what is handed to it here is exactly
    // that value, so the widening `defineEndpoint` performed is paid back at this line and nowhere else.
    return (response.unwrap ?? identity)(parsed.data) as OutputOf<E>;
  }

  /**
   * The endpoint's declared schema for one part of a call, or the part as it was handed over.
   *
   * A part with no schema is one this library never sends caller-supplied values through — `params` for an
   * OAuth address that names no placeholder, `query` for a call whose credential `auth` puts there itself
   * — and is passed through untouched rather than invented here.
   */
  function check<S extends z.ZodType | undefined>(schema: S, value: unknown, operation: string): PathParams {
    if (schema === undefined) return (value ?? {}) as PathParams;
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw inputRejected(operation, parsed.error);
    return parsed.data as PathParams;
  }

  /** The address, or the `config` failure explaining why none exists. */
  function address(endpoint: AnyEndpoint, params: PathParams, query: PathParams): URL {
    try {
      const url = new URL(buildPath(endpoint.path, params), apiBase);
      for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
      if (endpoint.auth === 'query-token') url.searchParams.set('access_token', store.getAccessToken());
      return url;
    } catch (error) {
      throw cannotAssemble(endpoint.operation, error);
    }
  }

  /**
   * The media types and the credential, or nothing at all.
   *
   * The three-piece header is what every Open API call carries, which is why `auth` decides it here rather
   * than leaving it to whoever assembles a call: an endpoint that reads as `'headers'` cannot be called
   * without it, and one that reads as `'none'` — the OAuth endpoints, which answer in their own vocabulary
   * and carry their credential in the query — sends neither the header nor a `Content-Type`, exactly as it
   * does today. A credential missing any piece fails as the store's own `config` error, naming which one.
   */
  function headersFor(endpoint: AnyEndpoint): FetcherRequestInit['headers'] {
    return endpoint.auth === 'headers' ? { 'Content-Type': 'application/json', Accept: 'application/json', ...store.getAuthHeaders() } : undefined;
  }
}

/**
 * The body of a call as JSON, or the failure explaining why there is not one.
 *
 * Two things can stop a body existing, and they are worth telling apart only by where they are caught. An
 * endpoint that declares none is a `GET`, and nothing here applies to it. One that declares a schema and is
 * handed something the schema refuses is an `input_rejected` — the caller's own argument, settled before a
 * byte of it is written out. And a body the schema accepted but that will not become JSON — a circular
 * `values`, which is exactly what a caller that meant to send a row of cells may hand over — is a failure
 * to assemble, with the serializer's reason kept as the cause.
 *
 * What is stringified is the value the schema returned rather than the one it was handed, so the bytes that
 * leave are the bytes that were checked, and nothing a schema would have stripped rides along.
 */
function sentBody(endpoint: AnyEndpoint, body: unknown): string | undefined {
  if (endpoint.body === undefined) return undefined;
  const checked = endpoint.body.safeParse(body);
  if (!checked.success) throw inputRejected(endpoint.operation, checked.error);

  try {
    return JSON.stringify(checked.data);
  } catch (error) {
    throw cannotAssemble(endpoint.operation, error);
  }
}

const identity = <T>(value: T): T => value;

/** The transport for a caller that brought none: the platform's own `fetch`, with nothing wrapped around it. */
const defaultFetcher: Fetcher = (url, init) => globalThis.fetch(url, init);
