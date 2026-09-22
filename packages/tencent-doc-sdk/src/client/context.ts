import type { Fetcher } from '@apollo/utils.fetcher';

/**
 * The things every way of reaching the upstream needs, resolved once per object built from them.
 */

/** What `createDocClient` and `createTokenManager` take in common. */
export interface ClientOptions {
  /** Where the calls go: `https://docs.qq.com`, or whatever stands in for it under a test. */
  readonly apiBase: string;
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

/** The options resolved into what a call actually carries. */
export interface ClientContext {
  readonly apiBase: string;
  readonly transport: Fetcher;
}

export function resolveContext(options: ClientOptions): ClientContext {
  return { apiBase: options.apiBase, transport: options.transport ?? defaultFetcher };
}

/** The transport for a caller that brought none: the platform's own `fetch`, with nothing wrapped around it. */
const defaultFetcher: Fetcher = (url, init) => globalThis.fetch(url, init);
