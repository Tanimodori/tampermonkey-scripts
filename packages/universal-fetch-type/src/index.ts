/// <reference types="node" />
import type { FetcherHeaders, FetcherRequestInit as ApolloRequestInit, FetcherResponse } from '@apollo/utils.fetcher';

/**
 * The repo's fetch-compatibility seam, in one place.
 *
 * `@apollo/utils.fetcher` writes `body?: string | Buffer`, and the bare `Buffer` there means
 * `Buffer<ArrayBufferLike>` — a view that may sit on a `SharedArrayBuffer`, because
 * `lib.es2017.sharedmemory.d.ts` merges `SharedArrayBuffer` into the `ArrayBufferTypes` map that
 * `ArrayBufferLike` is read out of. A DOM program refuses exactly that: `lib.dom.d.ts` spells the request
 * body type `BufferSource = ArrayBufferView<ArrayBuffer> | ArrayBuffer` and never names `SharedArrayBuffer`
 * at all. Since function parameters are checked contravariantly, that one field is enough to make a DOM
 * `fetch` unassignable to Apollo's `Fetcher` — no call ever sends a body, but the type says it could.
 *
 * `B` is that field, handed over. With the default it reproduces Apollo exactly; `Fetcher<Buffer<ArrayBuffer>>`
 * pins the backing memory to non-shared, which is the flavour that satisfies both worlds: a DOM `fetch` can be
 * handed in, an Apollo `Fetcher` can still be handed in, and the init this package builds can still be handed
 * to a browser `fetch`. `Uint8Array<ArrayBuffer>` gets the first and third but not the second — a
 * `Uint8Array` is not a `Buffer`, so an Apollo fetcher would no longer accept what we promise to pass it.
 */
export type Fetcher<B = Buffer> = (url: string, init?: FetcherRequestInit<B>) => Promise<FetcherResponse>;

/**
 * Apollo's request init with only `body` re-typed.
 *
 * Written as `Omit & {…}` rather than `interface extends`: an interface that re-declares `body` with another
 * type is an error, and module augmentation cannot narrow a member that already exists either.
 */
export type FetcherRequestInit<B = Buffer> = Omit<ApolloRequestInit, 'body'> & { readonly body?: string | B };

export type { FetcherHeaders, FetcherResponse };
