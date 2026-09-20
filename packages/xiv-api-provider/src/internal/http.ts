/**
 * Transport shared by the providers, and nothing else — no zod, no schema engine.
 *
 * The three sources differ too much in shape to share a validator, but what they do share is awkward to
 * duplicate honestly: issuing a request with a timeout, turning a non-OK response into a readable
 * failure, and parsing JSON. Only those live here, so a network error is reported the same way whichever
 * provider hit it.
 *
 * Returned bodies are checked by the caller with the small guards in each provider — shape checking at
 * runtime stops there, and zod validates returns from tests only.
 */

export type Provider = 'xivapi' | 'garlands' | 'datamine';

/** The subset of `fetch` a client needs, so a caller can hand in the pre-patch native one. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ProviderErrorKind = 'http' | 'network' | 'timeout' | 'shape' | 'unsupported';

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly provider: Provider;
  readonly url: string;
  /** The HTTP status, where one was received. */
  readonly status: number | null;
  /** The `code` of a JSON error body, where the service sent one. */
  readonly apiCode: number | null;
  /**
   * Declared rather than passed to `super`: the two-argument `Error` constructor is ES2022, and this
   * package targets ES2020 so its output stays usable wherever the userscripts run.
   */
  readonly cause?: unknown;

  constructor(init: {
    kind: ProviderErrorKind;
    provider: Provider;
    url: string;
    message: string;
    status?: number | null;
    apiCode?: number | null;
    cause?: unknown;
  }) {
    super(init.message);
    this.name = 'ProviderError';
    this.kind = init.kind;
    this.provider = init.provider;
    this.url = init.url;
    this.status = init.status ?? null;
    this.apiCode = init.apiCode ?? null;
    this.cause = init.cause;
  }
}

export const isProviderError = (error: unknown): error is ProviderError => error instanceof ProviderError;

/** A `404` that means "this locale has no such sheet" rather than "the request failed". */
export class NotFoundError extends Error {}

export interface SendOptions {
  readonly provider: Provider;
  readonly fetch: FetchLike;
  readonly timeoutMs: number;
  readonly accept: string;
  /** Pulls `{code, message}` out of an error body, when the service sends that shape. */
  readonly readError?: (body: unknown) => { code: number; message: string } | undefined;
}

/** Issue one GET. A non-OK status is not an exception here: only a transport failure is. */
export const sendRequest = async (url: URL, options: SendOptions): Promise<Response> => {
  try {
    return await options.fetch(url, {
      headers: { accept: options.accept },
      // Credentials never go to a third-party data host, and nothing here mutates.
      credentials: 'omit',
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (cause) {
    const timedOut = cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
    throw new ProviderError({
      kind: timedOut ? 'timeout' : 'network',
      provider: options.provider,
      url: url.toString(),
      message: timedOut ? `timed out after ${options.timeoutMs}ms: ${url}` : `request failed: ${url}`,
      cause,
    });
  }
};

/**
 * Send a request and parse its body as JSON.
 *
 * The error path tolerates a body that is not JSON at all, because a blocked origin answers with plain
 * text — and an error handler that throws is how one bad mirror turns into a broken page.
 */
export const getJson = async (url: URL, options: SendOptions): Promise<unknown> => {
  const response = await sendRequest(url, options);
  const text = await response.text();

  if (!response.ok) {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    const structured = options.readError === undefined ? undefined : options.readError(body);
    throw new ProviderError({
      kind: 'http',
      provider: options.provider,
      url: url.toString(),
      status: response.status,
      apiCode: structured?.code ?? null,
      message: structured?.message ?? (text.trim().slice(0, 200) || response.statusText || `HTTP ${response.status}`),
    });
  }

  if (text.trim() === '')
    throw new ProviderError({ kind: 'shape', provider: options.provider, url: url.toString(), status: response.status, message: `empty body from ${url}` });

  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new ProviderError({
      kind: 'shape',
      provider: options.provider,
      url: url.toString(),
      status: response.status,
      message: `expected JSON from ${url}`,
      cause,
    });
  }
};

/** `getJson`, narrowed by one of the provider guards. This is the whole runtime shape check on a response. */
export const getChecked = async <T>(url: URL, options: SendOptions, guard: (value: unknown) => value is T): Promise<T> => {
  const body = await getJson(url, options);
  if (!guard(body)) {
    throw new ProviderError({ kind: 'shape', provider: options.provider, url: url.toString(), status: null, message: `unexpected response shape from ${url}` });
  }
  return body;
};
