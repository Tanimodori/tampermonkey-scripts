import { describe, expect, it } from 'vitest';
import { ApiError, ApiErrorCodes, useBodyUnpacker, verifyResponseCode } from '@/index';
import type { ApiResponse, BodyUnpacker } from '@/index';
import { OK_BODY, PAYLOAD } from './fixtures';

/**
 * 两个通用件的语义：状态码映射与信封读取的缺省、覆盖与错误收拢。抛出的都是 `ApiError`。
 */

const responseOf = (status: number, body: unknown): ApiResponse => ({ status, headers: {}, body });

describe('verifyResponseCode', () => {
  it.each<[number, string]>([
    [401, ApiErrorCodes.UNAUTHORIZED],
    [403, ApiErrorCodes.UNAUTHORIZED],
    [429, ApiErrorCodes.RATE_LIMIT],
    [500, ApiErrorCodes.SERVER_ERROR],
    [503, ApiErrorCodes.SERVER_ERROR],
  ])('HTTP %i 归 %s', (status, errorCode) => {
    const response = responseOf(status, {});
    expect(() => verifyResponseCode(response)).toThrow(expect.objectContaining({ errorCode, message: `HTTP ${status}`, response }));
  });

  it.each([200, 204, 400, 404])('HTTP %i 静默通过', (status) => {
    expect(() => verifyResponseCode(responseOf(status, {}))).not.toThrow();
  });

  it('抛出的是 ApiError', () => {
    expect(() => verifyResponseCode(responseOf(500, {}))).toThrow(ApiError);
  });
});

describe('useBodyUnpacker', () => {
  it('缺省按信封读：code/msg/data', () => {
    const unpack = useBodyUnpacker();
    expect(unpack(responseOf(200, OK_BODY))).toEqual(PAYLOAD);
  });

  it('缺省判定不过抛 BAD_REQUEST，消息取 msg', () => {
    const unpack = useBodyUnpacker();
    expect(() => unpack(responseOf(200, { code: 401, msg: 'token expired', data: null }))).toThrow(
      expect.objectContaining({ errorCode: ApiErrorCodes.BAD_REQUEST, message: 'token expired' }),
    );
  });

  it('msg 缺失时按 code 兜底，code 也读不出时报 body 不可读', () => {
    const unpack = useBodyUnpacker();
    expect(() => unpack(responseOf(200, { code: 7 }))).toThrow(expect.objectContaining({ message: 'Invalid response code: 7' }));
    expect(() => unpack(responseOf(200, {}))).toThrow(expect.objectContaining({ message: 'Invalid response body' }));
  });

  it('读取规则可以覆盖：字符串是 body 的属性名，函数收下 body', () => {
    const unpack = useBodyUnpacker<{ id: string }>({
      codeGetter: 'ret',
      msgGetter: (body) => (body as { error?: string }).error ?? '',
      dataGetter: (body) => (body as { payload: { id: string } }).payload,
    });

    expect(unpack(responseOf(200, { ret: 0, error: '', payload: { id: 'x1' } }))).toEqual({ id: 'x1' });
    expect(() => unpack(responseOf(200, { ret: 9, error: 'retired', payload: null }))).toThrow(
      expect.objectContaining({ errorCode: ApiErrorCodes.BAD_REQUEST, message: 'retired' }),
    );
  });

  it('isBodyValid 可以覆盖判定', () => {
    const unpack = useBodyUnpacker<unknown>({ isBodyValid: () => true, dataGetter: (body) => body });
    expect(unpack(responseOf(200, { whatever: true }))).toEqual({ whatever: true });
  });

  it('读取规则抛出的普通错误收拢成 ApiError（BAD_OUTPUT），原错误留在 cause', () => {
    const boom = new Error('payload 不是对象');
    const unpack = useBodyUnpacker({
      dataGetter: () => {
        throw boom;
      },
    });
    const response = responseOf(200, OK_BODY);

    expect(() => unpack(response)).toThrow(ApiError);
    expect(() => unpack(response)).toThrow(
      expect.objectContaining({ errorCode: ApiErrorCodes.BAD_OUTPUT, message: 'payload 不是对象', response, cause: boom }),
    );
  });

  it('isBodyValid 抛出的错误同样收拢', () => {
    const unpack = useBodyUnpacker({
      isBodyValid: () => {
        throw new Error('bad predicate');
      },
    });

    expect(() => unpack(responseOf(200, OK_BODY))).toThrow(expect.objectContaining({ errorCode: ApiErrorCodes.BAD_OUTPUT, message: 'bad predicate' }));
  });

  it('读取规则抛出的 ApiError 原样上抛，只补 response', () => {
    const custom = new ApiError({ errorCode: 'CUSTOM_CODE', message: 'custom reading failure' });
    const unpack = useBodyUnpacker({
      codeGetter: () => {
        throw custom;
      },
    });
    const response = responseOf(200, OK_BODY);

    expect(() => unpack(response)).toThrow(expect.objectContaining({ errorCode: 'CUSTOM_CODE', message: 'custom reading failure' }));
    expect(custom.response).toBe(response);
  });

  it('下游可以自行实现 BodyUnpacker', () => {
    const unpack: BodyUnpacker<number> = (response) => response.status;
    expect(unpack(responseOf(204, undefined))).toBe(204);
  });
});
