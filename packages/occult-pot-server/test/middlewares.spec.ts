import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { AppError } from '@/errors.ts';
import { errorHandler, methodNotAllowed, notFoundHandler } from '@/middlewares/errorHandler.ts';
import { captureLogs } from './helpers.ts';

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

const request = { method: 'GET', originalUrl: '/v1/pots?view=raw', path: '/pots' } as unknown as Request;

describe('errorHandler', () => {
  it('records a client error at warning and answers with the error envelope', () => {
    const records = captureLogs();
    const response = makeResponse();

    errorHandler({})(new AppError('NOT_FOUND', 'No handler for GET /nope'), request, response.res, (() => undefined) as NextFunction);

    expect(response.status()).toBe(404);
    expect(response.body()).toEqual({ error: { code: 'NOT_FOUND', message: 'No handler for GET /nope' }, requestId: 'unknown' });
    expect(records).toEqual([
      {
        level: 'warning',
        message: 'Request rejected',
        requestId: 'unknown',
        method: 'GET',
        // The mounted prefix survives: `path` would have been just `/pots`.
        path: '/v1/pots?view=raw',
        status: 404,
        code: 'NOT_FOUND',
        error: 'No handler for GET /nope',
      },
    ]);
  });

  it('records a server error at error', () => {
    const records = captureLogs();
    const response = makeResponse();

    errorHandler({})(new AppError('UPSTREAM_FAILED', 'Tencent Docs returned HTTP 500'), request, response.res, (() => undefined) as NextFunction);

    expect(response.status()).toBe(502);
    expect(records[0]).toMatchObject({ level: 'error', message: 'Request failed', status: 502, code: 'UPSTREAM_FAILED' });
  });

  it('classifies the failures body-parser throws', () => {
    const records = captureLogs();
    const response = makeResponse();

    const tooLarge = Object.assign(new Error('request entity too large'), { type: 'entity.too.large' });
    errorHandler({})(tooLarge, request, response.res, (() => undefined) as NextFunction);

    expect(response.status()).toBe(413);
    expect(response.body()).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
    expect(records[0]).toMatchObject({ level: 'warning', status: 413 });
  });

  it('answers an unrecognised failure with an internal error and hides its detail', () => {
    const records = captureLogs();
    const response = makeResponse();

    errorHandler({ isProduction: true })(new Error('kaboom'), request, response.res, (() => undefined) as NextFunction);

    expect(response.status()).toBe(500);
    expect(response.body()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' }, requestId: 'unknown' });
    expect(records[0]).toMatchObject({ level: 'error', message: 'Request failed', status: 500, error: 'kaboom' });
  });

  it('carries the error headers onto the response', () => {
    captureLogs();
    const response = makeResponse();

    errorHandler({})(
      new AppError('UPSTREAM_RATE_LIMITED', 'rate limited', { retryAfterSeconds: 60, headers: { Allow: 'GET, POST' } }),
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
    const error = new AppError('UPSTREAM_FAILED', 'too late');
    let forwarded: unknown;
    Object.defineProperty(response.res, 'headersSent', { value: true });

    errorHandler({})(error, request, response.res, ((value: unknown) => (forwarded = value)) as NextFunction);

    expect(forwarded).toBe(error);
    expect(records).toEqual([]);
  });
});

describe('fallbacks', () => {
  it('answers an unclaimed path by throwing NOT_FOUND', () => {
    let forwarded: unknown;
    notFoundHandler()(request, makeResponse().res, ((value: unknown) => (forwarded = value)) as NextFunction);

    expect(forwarded).toBeInstanceOf(AppError);
    expect(forwarded).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect((forwarded as Error).message).toContain('GET /v1/pots?view=raw');
  });

  it('answers an unsupported verb by throwing METHOD_NOT_ALLOWED with Allow', () => {
    let forwarded: unknown;
    methodNotAllowed(['GET', 'POST'])(request, makeResponse().res, ((value: unknown) => (forwarded = value)) as NextFunction);

    expect(forwarded).toMatchObject({ code: 'METHOD_NOT_ALLOWED', status: 405 });
    expect((forwarded as AppError).headers.Allow).toBe('GET, POST');
  });
});
