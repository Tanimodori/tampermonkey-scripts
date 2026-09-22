import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadTestConfig } from '@test/testUtils/helpers.ts';
import type { Dispatcher } from 'undici';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { getFetcher, getClient, invalidateClient, useClient } from '@/services/upstream/client.ts';

/**
 * `client.ts` is the connection and nothing else: a pool sized by the configuration, the dispatcher it is
 * handed, and that pool seen as the one function `tencent-doc-sdk` sends through. These cases pin exactly
 * that, plus the two things the process-wide transport adds: it is built once per configuration, and
 * `loadConfig()`/`invalidateClient()` drop it so the next caller rebuilds it. What a call then does —
 * judging an answer, counting attempts — is `tencent-doc-sdk`'s own suite: `test/validation/classify.spec.ts`
 * and `test/client/request.spec.ts` over there.
 */

const servers: Array<{ close(): Promise<void> }> = [];

/** A throwaway HTTP server; the tests only use its port. */
async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push({
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterAll(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('useClient', () => {
  it('sends a request through the pool it built and hands back the response', async () => {
    const origin = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ret: 0 }));
    });
    loadTestConfig();

    const response = await useClient().request({ origin, path: '/anything', method: 'GET' });

    expect(response.statusCode).toBe(200);
    await expect(response.body.text()).resolves.toBe('{"ret":0}');
  });

  it('gives up on a request that never answers, at the configured timeout', async () => {
    const origin = await listen(() => {
      // Deliberately never responds.
    });
    loadTestConfig({ OPS_UPSTREAM_TIMEOUT_MS: '50' });
    const startedAt = Date.now();

    // The pool's own timers impose this: what the failure then reads as is `test/client/request.spec.ts`
    // in `tencent-doc-sdk`.
    // undici's own timer resolution is a whole second, so this is "the configured timeout, not the
    // ten-second default" rather than an exact figure.
    await expect(useClient().request({ origin, path: '/slow', method: 'GET' })).rejects.toMatchObject({ code: 'UND_ERR_HEADERS_TIMEOUT' });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it('sends on the dispatcher it is handed, wrapping nothing over it', () => {
    loadTestConfig();
    const dispatcher = {} as Dispatcher;

    // What a caller hands in is what it gets back, unwrapped: the pool the options above would build is
    // never built, which is how the library ends up sending on a dispatcher of the test's choosing.
    expect(useClient({ dispatcher })).toBe(dispatcher);
    expect(getClient({ dispatcher })).toBe(dispatcher);
  });
});

describe('getFetcher', () => {
  it('answers the way the library reads an answer: status, header pairs, a body to parse', async () => {
    const origin = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json', 'retry-after': '7' });
      response.end(JSON.stringify({ ret: 0, msg: 'Succeed' }));
    });
    loadTestConfig();

    const response = await getFetcher()(`${origin}/openapi/smartbook/v2/files/any/sheets`, { method: 'GET' });

    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)['retry-after']).toBe('7');
    await expect(response.json()).resolves.toMatchObject({ ret: 0 });
  });

  it('bounds a hung call by the pool’s own timeout, having registered none itself', async () => {
    const origin = await listen(() => {
      // Deliberately never responds.
    });
    loadTestConfig({ OPS_UPSTREAM_TIMEOUT_MS: '50' });
    const send = getFetcher();
    const startedAt = Date.now();

    // The library sends no `signal` any more, so this rejection is the pool giving up — with undici's own
    // headers-timeout underneath a `fetch failed`. `tencent-doc-sdk` words it as a transport failure.
    await expect(send(`${origin}/slow`, { method: 'GET' })).rejects.toThrow();
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});

describe('getClient', () => {
  it('builds the default transport once and hands the same one back', () => {
    loadTestConfig();
    // A previous case may have replaced the configuration; building here is what makes the identity
    // below about the cache rather than about a transport nothing had asked for yet.
    const first = getClient();

    expect(getClient()).toBe(first);
    // A transport built from a dispatcher the caller owns is never the default one.
    expect(getClient({ dispatcher: {} as Dispatcher })).not.toBe(first);
  });

  it('builds a transport from the options it is given, without caching it', () => {
    loadTestConfig();
    const defaultClient = getClient();

    expect(getClient({ dispatcher: {} as Dispatcher })).not.toBe(getClient({ dispatcher: {} as Dispatcher }));
    expect(getClient()).toBe(defaultClient);
  });

  it('rebuilds the default transport once the configuration is reloaded', () => {
    loadTestConfig();
    const before = getClient();

    // `loadConfig()` replaces the cached configuration and invalidates what was built from it: a
    // pool's timeouts cannot follow a replacement that already happened.
    loadTestConfig();

    expect(getClient()).not.toBe(before);
  });

  it('rebuilds the default transport when the invalidation is explicit', () => {
    loadTestConfig();
    const before = getClient();

    invalidateClient();

    expect(getClient()).not.toBe(before);
  });
});
