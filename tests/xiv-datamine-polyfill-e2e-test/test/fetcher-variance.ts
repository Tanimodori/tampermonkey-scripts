import type { WebFetcher, WebFetcherRequestInit } from 'xiv-api-provider';

/**
 * Compile-only: which ways a DOM program can meet this seam.
 *
 * Judged by `tsconfig.node.json`, and only there — it is the one config in this project that has both DOM
 * and Node's `Buffer` in the same program, which is exactly the combination a userscript author compiles
 * against. `src/`'s own config has no Node types, so it cannot write the flavour at all, and `skipLibCheck`
 * there would wave at the declarations anyway: a green `src/` is not evidence of anything here.
 *
 * The point under test is the one field `@apollo/utils.fetcher` gets wrong for a browser: its `body?: string |
 * Buffer` allows a `Buffer` backed by a `SharedArrayBuffer`, which no DOM request body type accepts. Naming
 * that flavour — `Fetcher<Buffer<ArrayBuffer>>`, exported as `WebFetcher` — is what makes all three of these
 * hold at once. The alias only moves where the pin is written, not what reading it takes: `Buffer` still has
 * to be in the program, which is why this file stays on the Node side.
 */

/** A browser's own `fetch`, handed in as the transport with nothing wrapped around it. */
export const nativeFetchAsTransport: WebFetcher = globalThis.fetch;

/** ...and the init the seam describes is still something a DOM `fetch` can be handed. */
export const forwardToFetch = (url: string, init: WebFetcherRequestInit): Promise<Response> =>
  globalThis.fetch(url, { ...init, body: init.body === undefined ? undefined : String(init.body) });
