import { describe, expect, it } from 'vitest';
import { ApiError, ApiErrorCodes, isApiError, wrapApiError } from '@/index';
import type { ApiResponse } from '@/index';

/**
 * ApiError 层：字段、缺省消息、包装的补缺规则与守卫。
 */

describe('ApiError', () => {
  it('字段来自 init', () => {
    const error = new ApiError({ errorCode: 'CUSTOM_CODE', message: 'boom', operation: 'listMessages' });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ApiError');
    expect(error.errorCode).toBe('CUSTOM_CODE');
    expect(error.message).toBe('boom');
    expect(error.operation).toBe('listMessages');
    expect(error.request).toBeUndefined();
    expect(error.response).toBeUndefined();
    expect(error.cause).toBeUndefined();
  });

  it('message 缺省取 cause 的消息', () => {
    const cause = new Error('inner failure');
    const error = new ApiError({ errorCode: 'CUSTOM_CODE', cause });

    expect(error.message).toBe('inner failure');
    expect(error.cause).toBe(cause);
  });
});

describe('wrapApiError', () => {
  it('不是 ApiError 的按 init 新建，原错误留在 cause', () => {
    const cause = new Error('socket hang up');
    const wrapped = wrapApiError(cause, { errorCode: ApiErrorCodes.NETWORK_ERROR, operation: 'listMessages' });

    expect(wrapped).toBeInstanceOf(ApiError);
    expect(wrapped.message).toBe('socket hang up');
    expect(wrapped.cause).toBe(cause);
    expect(wrapped.operation).toBe('listMessages');
  });

  it('已是 ApiError 的只补缺，不覆盖已有值', () => {
    const existing = new ApiError({ errorCode: 'CUSTOM_CODE', message: 'keep me', operation: 'first' });
    const response: ApiResponse = { status: 500, headers: {}, body: {} };
    const wrapped = wrapApiError(existing, { errorCode: ApiErrorCodes.BAD_OUTPUT, operation: 'second', response });

    expect(wrapped).toBe(existing);
    expect(wrapped.errorCode).toBe('CUSTOM_CODE');
    expect(wrapped.message).toBe('keep me');
    expect(wrapped.operation).toBe('first');
    expect(wrapped.response).toBe(response);
  });
});

describe('isApiError', () => {
  it('只认 ApiError 实例', () => {
    expect(isApiError(new ApiError({ errorCode: 'CUSTOM_CODE' }))).toBe(true);
    expect(isApiError(new Error('plain'))).toBe(false);
    expect(isApiError(undefined)).toBe(false);
  });
});

describe('ApiErrorCodes', () => {
  it('值即名字，覆盖已知的分类', () => {
    expect(ApiErrorCodes).toEqual({
      BAD_INPUT: 'BAD_INPUT',
      NETWORK_ERROR: 'NETWORK_ERROR',
      SERVER_ERROR: 'SERVER_ERROR',
      RATE_LIMIT: 'RATE_LIMIT',
      BAD_REQUEST: 'BAD_REQUEST',
      UNAUTHORIZED: 'UNAUTHORIZED',
      BAD_OUTPUT: 'BAD_OUTPUT',
    });
  });
});
