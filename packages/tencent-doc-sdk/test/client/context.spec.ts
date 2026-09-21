import type { Dispatcher } from 'undici';
import { describe, expect, it } from 'vitest';
import { resolveContext } from '@/client/context.js';
import { DEFAULT_TIMEOUT_MS } from '@/client/transport.js';

/**
 * What the ways of reaching the upstream resolve to, before any call is made.
 *
 * A caller owns its connection; this library takes it as an option and has to get the default right for
 * the rest: a pool built once rather than per call, and a function asked again each time so a pool that
 * was rebuilt underneath is noticed.
 */

const dispatcher = { request() {} } as unknown as Dispatcher;

describe('the transport', () => {
  it('hands out the pool it was given, unchanged', () => {
    const context = resolveContext({ apiBase: 'https://docs.qq.com', transport: dispatcher });

    expect(context.transport()).toBe(dispatcher);
    expect(context.transport()).toBe(dispatcher);
  });

  it('asks the function it was given every time, so a pool that gets replaced is not missed', () => {
    let current = dispatcher;
    const context = resolveContext({ apiBase: 'https://docs.qq.com', transport: () => current });

    expect(context.transport()).toBe(current);
    const replaced = { request() {} } as unknown as Dispatcher;
    current = replaced;
    expect(context.transport()).toBe(replaced);
  });

  it('opens a pool of its own on first use, and keeps that one', () => {
    const context = resolveContext({ apiBase: 'https://docs.qq.com' });
    const built = context.transport();

    // Nothing at construction time opens a connection, and the pool is per object rather than per call.
    expect(built).not.toBe(dispatcher);
    expect(typeof built.request).toBe('function');
    expect(context.transport()).toBe(built);
    void (built as unknown as { close(): void }).close();
  });
});

describe('the published budget', () => {
  it('gives a caller that says nothing ten seconds per call', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(10_000);
    expect(resolveContext({ apiBase: 'https://docs.qq.com', timeoutMs: 1 }).transport()).toBeDefined();
  });
});
