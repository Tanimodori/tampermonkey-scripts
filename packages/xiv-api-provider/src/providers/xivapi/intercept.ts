import { isInterestingUrl, type PackageSource } from './detect.ts';

/**
 * The fetch interception both userscripts perform, with the failure modes of the shared copy fixed.
 *
 * `universalis-zh-data/src/hooks.ts` and `xivanalysis-zh/src/hooks.ts` are byte-identical, and each of
 * the four problems below is visible in them:
 *
 * 1. They call `response.clone().json()` on **every** response on the page. Any non-JSON reply — a 204,
 *    a blob, an HTML error page — throws inside the hook and takes down an unrelated request.
 * 2. `args[0].toString()` renders a `Request` object as `'[object Request]'`, so a page that calls
 *    `fetch(new Request(url))` is never matched and silently stops being polyfilled.
 * 3. They rebuild the reply as `new Response(JSON.stringify(...))`, dropping the original status and
 *    `Content-Type`, so the page sees a 200 with no media type where it expected JSON.
 * 4. The injector cannot decline. To leave a response alone it has to return the response it was given,
 *    which is easy to get wrong in the middle of a branch.
 */

/** One intercepted exchange: the address, the untouched response, and its parsed body. */
export interface Package<T = unknown> {
  readonly url: string;
  readonly response: Response;
  readonly json: T;
  /** The original call, so an injector can re-issue it if it needs to. */
  readonly source: PackageSource;
}

/**
 * Return a replacement response, or `null`/`undefined` to let the original through unchanged.
 * Throwing is also treated as declining: the page must not break because a polyfill failed.
 */
export type PackageInjector = (pkg: Package) => Promise<Response | null | undefined> | Response | null | undefined;

export interface InterceptOptions {
  /** Where a hook should send its own outbound requests. Pass the captured native `fetch`. */
  readonly fetch?: typeof fetch;
  /** Called for any error the hook absorbs. Defaults to silent, so a page never gains console noise. */
  readonly onError?: (error: unknown, url: string) => void;
  /** Override the URL filter; the default is `isInterestingUrl`. */
  readonly interested?: (url: string) => boolean;
}

/** Headers that would misdescribe a body we just re-serialized. Everything else is copied. */
const UNSAFE_COPIED_HEADERS: readonly string[] = ['content-encoding', 'content-length', 'transfer-encoding', 'set-cookie', 'connection', 'keep-alive'];

/**
 * Build a replacement response that keeps the original's status and headers.
 *
 * Status and `statusText` are copied so a caller that checks `response.ok` sees what it saw before; a
 * non-OK status is preserved because rewriting the body of an error must not turn it into a success.
 */
export const jsonResponseFrom = (original: Response, body: unknown): Response => {
  const headers = new Headers();
  original.headers.forEach((value, key) => {
    if (!UNSAFE_COPIED_HEADERS.includes(key.toLowerCase())) headers.set(key, value);
  });
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status: original.status, statusText: original.statusText, headers });
};

/** Resolve the first `fetch` argument to an absolute URL string, for all three input forms. */
export const urlFromFetchInput = (input: string | URL | Request, base?: string): string | null => {
  try {
    if (input instanceof URL) return input.toString();
    // A `Request` carries its own url; `instanceof` is unreliable across realms, so duck-type instead.
    if (typeof (input as { url?: unknown }).url === 'string') return (input as Request).url;
    if (typeof input !== 'string') return null;

    // Absolute first: it needs nothing from the environment. Only a relative path requires a base, and
    // inventing one would let `/api/sheet/Item` silently match against the wrong origin.
    try {
      return new URL(input).toString();
    } catch {
      /* relative — fall through to base resolution */
    }

    const origin = base ?? globalThis.location?.href;
    if (origin === undefined) return null;
    return new URL(input, origin).toString();
  } catch {
    return null;
  }
};

/** The fetch that existed before any interception, for a script to make its own outbound calls with. */
export const captureNativeFetch = (): typeof fetch => globalThis.fetch.bind(globalThis);

/**
 * Wrap `globalThis.fetch` so `injector` sees responses it cares about.
 *
 * Returns a restore function, which the original hooks lack — without one, a script that is evaluated
 * twice (a userscript manager re-injecting on SPA navigation) stacks wrappers and each response is
 * parsed once per layer.
 */
export const installFetchInterceptor = (injector: PackageInjector, options: InterceptOptions = {}): (() => void) => {
  const native = options.fetch ?? captureNativeFetch();
  const interested = options.interested ?? isInterestingUrl;
  const original = globalThis.fetch;

  const handler: typeof fetch = async (input, init) => {
    const response = await native(input as string | URL | Request, init);

    const url = urlFromFetchInput(input, globalThis.location?.href);
    if (url === null || !interested(url)) return response;

    // Only clone what we intend to read, and only when it claims to be JSON.
    if (!response.headers.get('content-type')?.includes('json')) return response;

    let parsed: unknown;
    try {
      parsed = await response.clone().json();
    } catch (error) {
      options.onError?.(error, url);
      return response;
    }

    try {
      const replacement = await injector({ url, response, json: parsed, source: { url, body: parsed } });
      return replacement ?? response;
    } catch (error) {
      // A polyfill that throws must not become a page that fails to load.
      options.onError?.(error, url);
      return response;
    }
  };

  globalThis.fetch = handler;
  return () => {
    if (globalThis.fetch === handler) globalThis.fetch = original;
  };
};
