import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetchInterceptor, jsonResponseFrom, urlFromFetchInput } from '@/providers/xivapi/intercept.ts';
import type { PackageInjector } from '@/providers/xivapi/intercept.ts';

const SHEET_URL = 'https://xivapi-v2.xivcdn.com/api/sheet/Item?language=chs&fields=Name';
const body = { schema: 'exdschema@2:rev:0000000000000000000000000000000000000000', version: '2026071600010000', rows: [{ row_id: 1, fields: { Name: 'a' } }] };

const server = (response: Response) => vi.fn(async () => response) as unknown as typeof fetch;

const makeResponse = (init?: { status?: number; contentType?: string; body?: string; headers?: Record<string, string> }) =>
  new Response(init?.body ?? JSON.stringify(body), {
    status: init?.status ?? 200,
    statusText: init?.status === 404 ? 'Not Found' : 'OK',
    headers: { 'content-type': init?.contentType ?? 'application/json', ...init?.headers },
  });

let restore: (() => void) | undefined;

// Without this, a later file inherits a still-wrapped `globalThis.fetch` and its first assertion compares
// against the previous test's handler rather than against the real one.
afterEach(() => {
  restore?.();
  restore = undefined;
});

const install = (injector: PackageInjector, response: Response) => {
  restore?.();
  restore = installFetchInterceptor(injector, { fetch: server(response) });
  return globalThis.fetch;
};

describe('what the hook reads', () => {
  it('leaves a non-JSON response completely alone', async () => {
    // The defect that makes the current shared hook dangerous: it calls `.json()` on every response on the
    // page, so any 204, blob or HTML error page throws inside the hook and takes down an unrelated request.
    const untouched = makeResponse({ contentType: 'text/html', body: '<!doctype html>' });
    const injector = vi.fn<PackageInjector>(() => null);
    const result = await install(injector, untouched)(SHEET_URL);
    expect(result).toBe(untouched);
    expect(injector).not.toHaveBeenCalled();
  });

  it('skips a URL that would not classify, without parsing it', async () => {
    const injector = vi.fn<PackageInjector>(() => null);
    await install(injector, makeResponse())('https://universalis.app/api/v2/Cosmos/46246');
    expect(injector).not.toHaveBeenCalled();
  });

  it('matches a call made with a Request object, which the old String(args[0]) never did', async () => {
    const seen: string[] = [];
    const injector = vi.fn<PackageInjector>((pkg) => {
      seen.push(pkg.url);
      return null;
    });
    await install(injector, makeResponse())(new Request(SHEET_URL));
    expect(seen).toEqual([SHEET_URL]);
  });

  it('restores itself when torn down', () => {
    const before = globalThis.fetch;
    install(() => null, makeResponse());
    expect(globalThis.fetch).not.toBe(before);
    restore?.();
    expect(globalThis.fetch).toBe(before);
  });
});

describe('what the hook returns', () => {
  it('keeps the status and content type of a rewritten body', async () => {
    const fetched = install((pkg) => jsonResponseFrom(pkg.response, { ...body, marker: 'replaced' }), makeResponse());
    const result = await fetched(SHEET_URL);
    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toContain('application/json');
    expect(((await result.json()) as typeof body & { marker: string }).marker).toBe('replaced');
  });

  it('does not turn an error into a success just because it rewrote the body', async () => {
    const fetched = install((pkg) => jsonResponseFrom(pkg.response, { rewritten: true }), makeResponse({ status: 404 }));
    const result = await fetched(SHEET_URL);
    expect(result.status).toBe(404);
    expect(result.ok).toBe(false);
  });

  it('passes the original through when the injector declines', async () => {
    const response = makeResponse();
    expect(await install(() => null, response)(SHEET_URL)).toBe(response);
  });

  it('absorbs an injector that throws, and reports it', async () => {
    const response = makeResponse();
    const onError = vi.fn();
    restore?.();
    restore = installFetchInterceptor(
      () => {
        throw new Error('polyfill blew up');
      },
      { fetch: server(response), onError },
    );
    expect(await globalThis.fetch(SHEET_URL)).toBe(response);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('drops a content-length that no longer describes the body', async () => {
    const fetched = install((pkg) => jsonResponseFrom(pkg.response, { small: true }), makeResponse({ headers: { 'content-length': '9999' } }));
    expect((await fetched(SHEET_URL)).headers.get('content-length')).toBeNull();
  });
});

describe('url extraction', () => {
  it('handles all three fetch input forms', () => {
    expect(urlFromFetchInput('https://v2.xivapi.com/api/sheet/Item')).toBe('https://v2.xivapi.com/api/sheet/Item');
    expect(urlFromFetchInput(new URL(SHEET_URL))).toBe(SHEET_URL);
    expect(urlFromFetchInput(new Request(SHEET_URL))).toBe(SHEET_URL);
    expect(urlFromFetchInput('not-an-url')).toBeNull();
  });

  it('resolves a root-relative path only when it has a page to resolve against', () => {
    expect(urlFromFetchInput('/api/sheet/Item', 'https://v2.xivapi.com/')).toBe('https://v2.xivapi.com/api/sheet/Item');
    expect(urlFromFetchInput('/api/sheet/Item')).toBeNull();
  });
});
