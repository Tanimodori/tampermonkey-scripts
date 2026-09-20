import type { Dispatcher } from 'undici';
import { describe, expect, it } from 'vitest';
import { resolveContext } from '@/client/context.js';
import { unpaced } from '@/client/dispatch.js';
import type { CallOutcome, UpstreamHooks } from '@/client/hooks.js';
import { DEFAULT_TIMEOUT_MS } from '@/client/transport.js';

/**
 * What the three ways of reaching the upstream resolve to, before any call is made.
 *
 * A caller owns its connection, its pacing, its reporting and its clock; this library takes each of
 * them as an option and has to get the defaults right for the rest: a pool built once rather than per
 * call, a function asked again each time so a rebuilt pool is noticed, calls that go out immediately
 * when nobody paces them, and nowhere to report to when nobody asked.
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

describe('the pacing, the reporting and the clock', () => {
  it('sends immediately when the caller paces nothing', async () => {
    const context = resolveContext({ apiBase: 'https://docs.qq.com' });
    let sent = false;

    expect(context.dispatch).toBe(unpaced);
    await context.dispatch({ operation: 'getRecords' }, async () => {
      sent = true;
      return 'answered';
    });

    expect(sent).toBe(true);
  });

  it('runs the caller’s gate around one logical call', async () => {
    const seen: string[] = [];
    const context = resolveContext({
      apiBase: 'https://docs.qq.com',
      dispatch: async (call, next) => {
        seen.push(call.operation);
        return next();
      },
    });

    await context.dispatch({ operation: 'addRecords' }, async () => 1);

    expect(seen).toEqual(['addRecords']);
  });

  it('has nowhere to report to, and does not mind', () => {
    const context = resolveContext({ apiBase: 'https://docs.qq.com' });
    const listened: CallOutcome[] = [];
    const hooks: UpstreamHooks = { onCall: (_call, outcome) => listened.push(outcome) };

    expect(context.hooks).toBeUndefined();
    expect(resolveContext({ apiBase: 'https://docs.qq.com', hooks }).hooks).toBe(hooks);
    context.hooks?.onCall?.({ operation: 'getRecords', method: 'POST', path: '/p' }, { kind: 'answered', status: 200, ret: 0, durationMs: 1 });
    expect(listened).toHaveLength(0);
  });

  it('measures against the clock it was given, and against wall time otherwise', () => {
    const fixed = resolveContext({ apiBase: 'https://docs.qq.com', now: () => 1_789_140_693_000 });
    const wall = resolveContext({ apiBase: 'https://docs.qq.com' });

    expect(fixed.now()).toBe(1_789_140_693_000);
    expect(Math.abs(wall.now() - Date.now())).toBeLessThan(1_000);
  });
});
