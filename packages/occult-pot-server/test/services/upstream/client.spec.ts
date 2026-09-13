import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadTestConfig } from '@test/helpers.ts';
import { afterEach, describe, expect, it } from 'vitest';
import { closeClient, getClient } from '@/services/upstream/client.ts';

/**
 * The pool is the whole of `client.ts`, so this is the whole of its behaviour: one pool per loaded
 * configuration, able to talk to a server and to give up on one that never answers (the timeouts
 * come from the configuration, and the api layer relies on them to bound an attempt).
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

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('getClient', () => {
  it('shares one pool per configuration and rebuilds it when the configuration changes', async () => {
    loadTestConfig();
    const first = getClient();

    expect(getClient()).toBe(first);

    loadTestConfig({ OPS_UPSTREAM_TIMEOUT_MS: '5000' });
    expect(getClient()).not.toBe(first);

    await closeClient();
  });

  it('sends a request and hands back the response', async () => {
    const origin = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ret: 0 }));
    });
    loadTestConfig();

    const client = getClient();
    const response = await client.request({ origin, path: '/anything', method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });

    expect(response.statusCode).toBe(200);
    await expect(response.body.text()).resolves.toBe('{"ret":0}');
    await closeClient();
  });

  it('gives up on a request that never answers, at the configured timeout', async () => {
    const origin = await listen(() => {
      // Deliberately never responds.
    });
    loadTestConfig({ OPS_UPSTREAM_TIMEOUT_MS: '50' });

    const client = getClient();
    const startedAt = Date.now();

    await expect(client.request({ origin, path: '/slow', method: 'GET' })).rejects.toMatchObject({ code: 'UND_ERR_HEADERS_TIMEOUT' });
    // undici's own timer resolution is a whole second, so this is "the configured timeout, not the
    // ten-second default" rather than an exact figure.
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    await closeClient();
  });
});
