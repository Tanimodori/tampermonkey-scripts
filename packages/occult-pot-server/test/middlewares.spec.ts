import { captureLogs, loadTestConfig } from '@test/testUtils/helpers.ts';
/**
 * @module-tag redis
 */
import type { NextFunction, Request, Response } from 'express';
import type Redis from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/errors.ts';
import { clientIp } from '@/middlewares/clientIp.ts';
import { errorHandler, methodNotAllowed, notFoundHandler } from '@/middlewares/errorHandler.ts';
import { userContext } from '@/middlewares/userContext.ts';
import { setRedis } from '@/stores/redis.ts';

/**
 * The error handler is the only place a request-scoped error is recorded, so these tests pin both
 * halves of that: what the caller receives, and which level the operator sees it at.
 */

function makeResponse(): { res: Response; status: () => number | undefined; body: () => unknown; header: (name: string) => string | undefined } {
  const headers = new Map<string, string>();
  const state: { status?: number; body?: unknown } = {};
  const res = {
    headersSent: false,
    setHeader: (name: string, value: string) => void headers.set(name.toLowerCase(), value),
    status(code: number) {
      state.status = code;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  } as unknown as Response;

  return { res, status: () => state.status, body: () => state.body, header: (name) => headers.get(name.toLowerCase()) };
}

const request = { method: 'GET', originalUrl: '/api/v1/pots?view=raw', path: '/pots' } as unknown as Request;

describe('errorHandler', () => {
  it('records a client error at warning and answers with the error envelope', () => {
    const records = captureLogs();
    const response = makeResponse();

    errorHandler({})(new AppError('ERR_NOT_FOUND', 'No handler for GET /nope'), request, response.res, (() => undefined) as NextFunction);

    expect(response.status()).toBe(404);
    expect(response.body()).toEqual({ code: 'ERR_NOT_FOUND', data: null, message: 'No handler for GET /nope', requestId: 'unknown' });
    expect(records).toEqual([
      {
        level: 'warning',
        message: 'Request rejected',
        requestId: 'unknown',
        method: 'GET',
        // The mounted prefix survives: `path` would have been just `/pots`.
        path: '/api/v1/pots?view=raw',
        status: 404,
        code: 'ERR_NOT_FOUND',
        error: 'No handler for GET /nope',
      },
    ]);
  });

  it('records a server error at error', () => {
    const records = captureLogs();
    const response = makeResponse();

    errorHandler({})(new AppError('ERR_UPSTREAM_FAILED', 'Tencent Docs returned HTTP 500'), request, response.res, (() => undefined) as NextFunction);

    expect(response.status()).toBe(502);
    expect(records[0]).toMatchObject({ level: 'error', message: 'Request failed', status: 502, code: 'ERR_UPSTREAM_FAILED' });
  });

  it('classifies the failures body-parser throws', () => {
    const records = captureLogs();
    const response = makeResponse();

    const tooLarge = Object.assign(new Error('request entity too large'), { type: 'entity.too.large' });
    errorHandler({})(tooLarge, request, response.res, (() => undefined) as NextFunction);

    expect(response.status()).toBe(413);
    expect(response.body()).toMatchObject({ code: 'ERR_PAYLOAD_TOO_LARGE', data: null });
    expect(records[0]).toMatchObject({ level: 'warning', status: 413 });
  });

  it('answers an unrecognised failure with an internal error and hides its detail', () => {
    const records = captureLogs();
    const response = makeResponse();

    errorHandler({ isProduction: true })(new Error('kaboom'), request, response.res, (() => undefined) as NextFunction);

    expect(response.status()).toBe(500);
    expect(response.body()).toEqual({ code: 'ERR_INTERNAL_ERROR', data: null, message: 'Internal server error', requestId: 'unknown' });
    expect(records[0]).toMatchObject({ level: 'error', message: 'Request failed', status: 500, error: 'kaboom' });
  });

  it('keeps the stack of an unexpected failure out of the body and on the log line', () => {
    const records = captureLogs();
    const response = makeResponse();

    // Outside production the same failure is diagnosable — from the log, not from the response.
    errorHandler({})(new Error('kaboom'), request, response.res, (() => undefined) as NextFunction);

    expect(response.body()).toEqual({ code: 'ERR_INTERNAL_ERROR', data: null, message: 'Internal server error', requestId: 'unknown' });
    expect(records[0]?.stack).toEqual(expect.arrayContaining([expect.stringContaining('kaboom')]));
  });

  it('carries the error headers onto the response', () => {
    captureLogs();
    const response = makeResponse();

    errorHandler({})(
      new AppError('ERR_UPSTREAM_RATE_LIMITED', 'rate limited', { retryAfterSeconds: 60, headers: { Allow: 'GET, POST' } }),
      request,
      response.res,
      (() => undefined) as NextFunction,
    );

    expect(response.header('retry-after')).toBe('60');
    expect(response.header('allow')).toBe('GET, POST');
  });

  it('hands the error on when the response has already started', () => {
    const records = captureLogs();
    const response = makeResponse();
    const error = new AppError('ERR_UPSTREAM_FAILED', 'too late');
    let forwarded: unknown;
    Object.defineProperty(response.res, 'headersSent', { value: true });

    errorHandler({})(error, request, response.res, ((value: unknown) => (forwarded = value)) as NextFunction);

    expect(forwarded).toBe(error);
    expect(records).toEqual([]);
  });
});

describe('clientIp', () => {
  const withHeader = (value: string | undefined, ip: string | undefined): Request =>
    ({ headers: value === undefined ? {} : { 'x-real-ip': value }, ip }) as unknown as Request;

  it('takes the address from the proxy header', () => {
    expect(clientIp(withHeader('203.0.113.7', '127.0.0.1'))).toBe('203.0.113.7');
    expect(clientIp(withHeader(' 2001:db8::1 ', '127.0.0.1'))).toBe('2001:db8::1');
  });

  it('ignores a header that is not one bare address, and falls back to the socket', () => {
    // A client-supplied list, a hostname and an empty value are all "not the proxy's statement".
    expect(clientIp(withHeader('203.0.113.7, 10.0.0.9', '127.0.0.1'))).toBe('127.0.0.1');
    expect(clientIp(withHeader('example.com', '127.0.0.1'))).toBe('127.0.0.1');
    expect(clientIp(withHeader('', '127.0.0.1'))).toBe('127.0.0.1');
    expect(clientIp(withHeader(undefined, '10.0.0.1'))).toBe('10.0.0.1');
  });

  it('says unknown when there is no address at all', () => {
    expect(clientIp(withHeader(undefined, undefined))).toBe('unknown');
  });
});

describe('userContext', () => {
  afterEach(() => {
    setRedis(undefined);
  });

  it('hands the request on without waiting for the record to be written', () => {
    loadTestConfig();
    const response = makeResponse();
    let forwarded = false;

    userContext()({ ...request, ip: '10.0.0.1', requestId: 'req-1' } as unknown as Request, response.res, (() => {
      forwarded = true;
    }) as NextFunction);

    // The write is fire-and-forget: `next()` has already run by the time it settles.
    expect(forwarded).toBe(true);
  });

  it('touches nothing for a path it was told to skip', async () => {
    loadTestConfig();
    const records = captureLogs();
    // If the probe were recorded, this client would throw and the failure would be logged.
    setRedis({
      multi: () => {
        throw new Error('the probe should not have been recorded');
      },
    } as unknown as Redis);
    const response = makeResponse();
    let forwarded = false;

    userContext({ skip: ['/healthz'] })({ ...request, ip: '127.0.0.1', path: '/healthz', requestId: 'req-1' } as unknown as Request, response.res, (() => {
      forwarded = true;
    }) as NextFunction);

    expect(forwarded).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Nothing was attempted: had the skip not worked, the throwing client would have produced this.
    expect(records.filter((entry) => entry.message === 'Could not record the caller in Redis')).toEqual([]);
  });

  it('reports a Redis failure instead of failing the request', async () => {
    loadTestConfig();
    const records = captureLogs();
    setRedis({
      multi: () => {
        throw new Error('redis is down');
      },
    } as unknown as Redis);
    const response = makeResponse();
    let forwarded = false;

    userContext()({ ...request, ip: '10.0.0.1', requestId: 'req-1' } as unknown as Request, response.res, (() => {
      forwarded = true;
    }) as NextFunction);

    expect(forwarded).toBe(true);
    await vi.waitFor(() => {
      expect(records.find((entry) => entry.message === 'Could not record the caller in Redis')?.reason).toBe('redis is down');
    });
  });
});

describe('fallbacks', () => {
  it('answers an unclaimed path by throwing NOT_FOUND', () => {
    let forwarded: unknown;
    notFoundHandler()(request, makeResponse().res, ((value: unknown) => (forwarded = value)) as NextFunction);

    expect(forwarded).toBeInstanceOf(AppError);
    expect(forwarded).toMatchObject({ code: 'ERR_NOT_FOUND', status: 404 });
    expect((forwarded as Error).message).toContain('GET /api/v1/pots?view=raw');
  });

  it('answers an unsupported verb by throwing METHOD_NOT_ALLOWED with Allow', () => {
    let forwarded: unknown;
    methodNotAllowed(['GET', 'POST'])(request, makeResponse().res, ((value: unknown) => (forwarded = value)) as NextFunction);

    expect(forwarded).toMatchObject({ code: 'ERR_METHOD_NOT_ALLOWED', status: 405 });
    expect((forwarded as AppError).headers.Allow).toBe('GET, POST');
  });
});
