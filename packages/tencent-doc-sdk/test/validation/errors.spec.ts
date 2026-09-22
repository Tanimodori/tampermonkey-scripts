import { describe, expect, it } from 'vitest';
import { TencentDocsError } from '@/validation/errors';

/**
 * The one error type this library answers a failed call with.
 *
 * It carries what the upstream said and nothing this library decided on the caller's behalf: no HTTP
 * status to answer with, no verdict on whether another attempt would help — the library never retries,
 * so a `retryable` flag here would promise a policy that does not exist.
 */

describe('one failed call', () => {
  it('is an Error with this name, so a caller can branch on the kind rather than the wording', () => {
    const error = new TencentDocsError('server', 'Tencent Docs returned HTTP 500 for getRecords');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TencentDocsError');
    expect(error.message).toBe('Tencent Docs returned HTTP 500 for getRecords');
  });

  it('carries everything the upstream said about it', () => {
    const error = new TencentDocsError('rate_limited', 'too many calls', {
      status: 429,
      ret: 400007,
      msg: '请求数超过限制',
      retryAfterSeconds: 7,
      maskedBody: '{"ret":400007}',
    });

    expect(error).toMatchObject({ code: 'rate_limited', status: 429, ret: 400007, msg: '请求数超过限制', retryAfterSeconds: 7, maskedBody: '{"ret":400007}' });
  });

  it('leaves out what the answer did not carry, rather than inventing a zero', () => {
    const error = new TencentDocsError('transport', 'Request to getRecords failed');

    expect(error.status).toBeUndefined();
    expect(error.ret).toBeUndefined();
    expect(error.retryAfterSeconds).toBeUndefined();
    expect('retryAfterSeconds' in error).toBe(true);
  });

  it('keeps the failure underneath it, which is the only place a raw transport error can be reported', () => {
    const cause = new Error('socket hang up');

    expect(new TencentDocsError('transport', 'Request to getRecords failed', { cause }).cause).toBe(cause);
    expect(new TencentDocsError('auth', 'rejected').cause).toBeUndefined();
  });

  it('says nothing about a second attempt', () => {
    const error = new TencentDocsError('server', 'Tencent Docs returned HTTP 500 for getRecords', { status: 500 });

    expect('retryable' in error).toBe(false);
    expect('delayMs' in error).toBe(false);
    // The status is the upstream's, not the one a caller should answer with — that mapping is the
    // caller's own vocabulary.
    expect((error as unknown as Record<string, unknown>).httpStatus).toBeUndefined();
  });
});
