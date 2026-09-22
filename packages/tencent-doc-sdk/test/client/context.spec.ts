import type { Fetcher } from '@apollo/utils.fetcher';
import { describe, expect, it } from 'vitest';
import { resolveContext } from '@/client/context';

/**
 * What a transport resolves to, before any call is made.
 *
 * The caller owns the connection and every budget that comes with it, so this library takes one function
 * and has to get two things right about it: the one it was given is the one a call goes through, and the
 * one it falls back to is the platform's own `fetch` — with nothing wrapped around it, because a timeout,
 * a proxy or a retry is the caller's decision rather than something this library may assume.
 */

const fetcher: Fetcher = async () => new Response('{}');

describe('the transport', () => {
  it('sends through the fetcher it was given, unchanged', () => {
    const context = resolveContext({ apiBase: 'https://docs.qq.com', transport: fetcher });

    expect(context.transport).toBe(fetcher);
  });

  it('falls back to the platform’s own fetch, and adds nothing to the call', async () => {
    const original = globalThis.fetch;
    const seen: Array<{ url: unknown; init: unknown }> = [];
    globalThis.fetch = async (url, init) => {
      seen.push({ url, init });
      return new Response('{}');
    };

    try {
      const context = resolveContext({ apiBase: 'https://docs.qq.com' });
      await context.transport('https://docs.qq.com/openapi/sheets', { method: 'GET' });
    } finally {
      globalThis.fetch = original;
    }

    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('https://docs.qq.com/openapi/sheets');
    // No `signal`, no headers of its own: how long a call may hang is what the fetch was built to allow.
    expect(seen[0]?.init).toEqual({ method: 'GET' });
  });
});
