import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { apiOrigin, loadTestConfig, setupTencentDocsMock } from '@test/testUtils/helpers.ts';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { useClient } from '@/services/upstream/client.ts';
import type { CallOptions } from '@/services/upstream/interceptors/classify.ts';

/**
 * `client.ts` is the composition and nothing else: a pool sized by the configuration — or a
 * dispatcher it is handed — with the classification and retry interceptors injected. These cases
 * pin exactly that; what each interceptor then does is `interceptors/classify.spec.ts` and
 * `interceptors/retry.spec.ts`.
 */

const docs = setupTencentDocsMock();

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

/** One request as `api/sheet.ts` builds it. */
function options(overrides: Partial<CallOptions> = {}): CallOptions {
  return {
    origin: apiOrigin(),
    path: '/openapi/smartbook/v2/files/300000000$ExAmPlEfIlEiD/sheets/tXXXXXX',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ getRecords: { offset: 0, limit: 100 } }),
    operation: 'getRecords',
    envelope: true,
    ...overrides,
  };
}

/** Every intercepted record read, in order: one per attempt. */
const readCalls = (): number => docs.state.calls.filter((call) => (call.body as Record<string, unknown> | undefined)?.getRecords !== undefined).length;

afterAll(async () => {
  await docs.close();
});

afterEach(async () => {
  docs.reset();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('useClient', () => {
  it('sends a request through the pool it built and hands back the response', async () => {
    const origin = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ret: 0 }));
    });
    loadTestConfig();

    const response = await useClient().request(options({ origin, path: '/anything' }));

    expect(response.statusCode).toBe(200);
    await expect(response.body.text()).resolves.toBe('{"ret":0}');
  });

  it('gives up on a request that never answers, at the configured timeout', async () => {
    const origin = await listen(() => {
      // Deliberately never responds.
    });
    // No retries: this is about the timeout, which the pool's own timers impose.
    loadTestConfig({ OPS_UPSTREAM_TIMEOUT_MS: '50', OPS_UPSTREAM_MAX_RETRIES: '0' });
    const startedAt = Date.now();

    await expect(useClient().request(options({ origin, path: '/slow', method: 'GET' }))).rejects.toMatchObject({ code: 'ERR_UPSTREAM_FAILED' });
    // undici's own timer resolution is a whole second, so this is "the configured timeout, not the
    // ten-second default" rather than an exact figure.
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });

  it('injects both interceptors over a dispatcher it is handed', async () => {
    loadTestConfig({ OPS_UPSTREAM_MAX_RETRIES: '1' });
    const client = useClient({ dispatcher: docs.agent });
    // One dropped connection: only the retry interceptor can turn this into a 200, and only the
    // classifier can turn the transport error into the failure that policy retries.
    docs.state.networkFailures = 1;

    const response = await client.request(options());

    expect(response.statusCode).toBe(200);
    expect(readCalls()).toBe(2);
  });
});
