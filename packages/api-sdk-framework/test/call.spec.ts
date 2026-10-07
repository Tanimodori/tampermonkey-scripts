import { describe, expect, it, vi } from 'vitest';
import { ApiError, ApiErrorCodes, createCall, useBodyUnpacker, verifyResponseCode } from '@/index';
import type { ApiRequest, ApiResponse, Endpoint, RequestSchema, ResponseSchema } from '@/index';
import { BASE_URL, OK_BODY, PAYLOAD, TOKEN } from './fixtures';
import { upstreamHanging, upstreamNotJson, upstreamOk, upstreamStatus, upstreamUnreachable } from './upstream';

/**
 * 调用链的三段：装配归 BAD_INPUT，发出与读取归 NETWORK_ERROR，判定与投影归 BAD_OUTPUT；已是 ApiError 的原样上抛。
 * 时限由 `CallOptions.timeoutMs` 或端点上的 `timeoutMs` 定下，到点抛 TIMEOUT。上游只由 `upstream.ts` 的自定义
 * fetch 扮演，作为 `transport` 递给 `createCall`。
 */

/** 一次调用用的上下文：适配器从这里取地址与凭据。 */
interface TestContext {
  readonly base: string;
  readonly token: string;
}

const context: TestContext = { base: BASE_URL, token: TOKEN };

interface Input {
  readonly limit: number;
}

interface Output {
  readonly payload: unknown;
  readonly token: string;
}

const MESSAGE_URL = `${BASE_URL}/message?limit=100`;

const endpoint = (overrides: Partial<Endpoint<TestContext, Input, Output>> = {}): Endpoint<TestContext, Input, Output> => ({
  operation: 'listMessages',
  requestAdaptor: (ctx, input): ApiRequest => ({
    url: new URL(`/message?limit=${input.limit}`, ctx.base).href,
    init: { headers: { Authorization: `Bearer ${ctx.token}` } },
  }),
  responseAdaptor: (ctx, response) => ({ payload: (response.body as { data: unknown }).data, token: ctx.token }),
  ...overrides,
});

describe('createCall', () => {
  it('正常一次往返：context 流经两个适配器，响应已解析', async () => {
    const transport = upstreamStatus(200, OK_BODY, { 'x-trace': 'abc' });
    const call = createCall<TestContext>({ transport });
    const responseAdaptor = vi.fn((ctx: TestContext, response: ApiResponse): Output => ({
      payload: (response.body as { data: unknown }).data,
      token: ctx.token,
    }));

    await expect(call(context, endpoint({ responseAdaptor }), { limit: 100 })).resolves.toEqual({ payload: PAYLOAD, token: TOKEN });

    expect(responseAdaptor).toHaveBeenCalledWith(context, {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-trace': 'abc' },
      body: OK_BODY,
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledWith(MESSAGE_URL, { headers: { Authorization: `Bearer ${TOKEN}` } });
  });

  it('装配段：requestSchema 不过，一个字节没发出', async () => {
    const transport = upstreamOk();
    const call = createCall<TestContext>({ transport });
    const requestSchema: RequestSchema<Input> = {
      parse: () => {
        throw new Error('limit out of range');
      },
    };

    await expect(call(context, endpoint({ requestSchema }), { limit: 100 })).rejects.toThrow(
      expect.objectContaining({ errorCode: ApiErrorCodes.BAD_INPUT, operation: 'listMessages', message: 'limit out of range' }),
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it('装配段：适配器拼不出地址也归 BAD_INPUT', async () => {
    const transport = upstreamOk();
    const call = createCall<TestContext>({ transport });
    const requestAdaptor = (): ApiRequest => {
      throw new Error('no base');
    };

    await expect(call(context, endpoint({ requestAdaptor }), { limit: 100 })).rejects.toThrow(
      expect.objectContaining({ errorCode: ApiErrorCodes.BAD_INPUT, message: 'no base' }),
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it('发出与读取段：连接失败归 NETWORK_ERROR，request 留在错误上', async () => {
    const transport = upstreamUnreachable(new Error('socket hang up'));
    const call = createCall<TestContext>({ transport });

    await expect(call(context, endpoint(), { limit: 100 })).rejects.toThrow(
      expect.objectContaining({
        errorCode: ApiErrorCodes.NETWORK_ERROR,
        message: 'socket hang up',
        operation: 'listMessages',
        request: expect.objectContaining({ url: MESSAGE_URL }),
      }),
    );
  });

  it('发出与读取段：到的不是 JSON 也归 NETWORK_ERROR', async () => {
    const transport = upstreamNotJson();
    const call = createCall<TestContext>({ transport });

    await expect(call(context, endpoint(), { limit: 100 })).rejects.toThrow(
      expect.objectContaining({ errorCode: ApiErrorCodes.NETWORK_ERROR, operation: 'listMessages' }),
    );
  });

  it('判定与投影段：适配器抛出归 BAD_OUTPUT，response 原样带上', async () => {
    const transport = upstreamOk();
    const call = createCall<TestContext>({ transport });
    const responseAdaptor = (): Output => {
      throw new Error('no data field');
    };

    await expect(call(context, endpoint({ responseAdaptor }), { limit: 100 })).rejects.toThrow(
      expect.objectContaining({
        errorCode: ApiErrorCodes.BAD_OUTPUT,
        message: 'no data field',
        operation: 'listMessages',
        request: expect.objectContaining({ url: MESSAGE_URL }),
        response: expect.objectContaining({ status: 200, body: OK_BODY }),
      }),
    );
  });

  it('判定与投影段：responseSchema 不过也归 BAD_OUTPUT', async () => {
    const transport = upstreamOk();
    const call = createCall<TestContext>({ transport });
    const responseSchema: ResponseSchema<Output> = {
      parse: () => {
        throw new Error('bad output shape');
      },
    };

    await expect(call(context, endpoint({ responseSchema }), { limit: 100 })).rejects.toThrow(
      expect.objectContaining({ errorCode: ApiErrorCodes.BAD_OUTPUT, message: 'bad output shape' }),
    );
  });

  it('已是 ApiError 的原样上抛，只补缺的字段', async () => {
    const custom = new ApiError({ errorCode: 'CUSTOM_CODE', message: 'custom failure' });
    const transport = upstreamOk();
    const call = createCall<TestContext>({ transport });
    const attempt = call(
      context,
      endpoint({
        responseAdaptor: () => {
          throw custom;
        },
      }),
      { limit: 100 },
    );

    await expect(attempt).rejects.toBe(custom);
    expect(custom.errorCode).toBe('CUSTOM_CODE');
    expect(custom.operation).toBe('listMessages');
    expect(custom.request).toEqual(expect.objectContaining({ url: MESSAGE_URL }));
    expect(custom.response).toEqual(expect.objectContaining({ status: 200 }));
  });

  it('三段失败抛出的都是 ApiError', async () => {
    const inputStage = createCall<TestContext>({ transport: upstreamOk() });
    await expect(
      inputStage(
        context,
        endpoint({
          requestSchema: {
            parse: () => {
              throw new Error('bad input');
            },
          },
        }),
        { limit: 1 },
      ),
    ).rejects.toBeInstanceOf(ApiError);

    const networkStage = createCall<TestContext>({ transport: upstreamUnreachable(new Error('down')) });
    await expect(networkStage(context, endpoint(), { limit: 1 })).rejects.toBeInstanceOf(ApiError);

    const outputStage = createCall<TestContext>({ transport: upstreamOk() });
    await expect(
      outputStage(
        context,
        endpoint({
          responseAdaptor: () => {
            throw new Error('bad output');
          },
        }),
        { limit: 1 },
      ),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('响应适配器里组合 verifyResponseCode 与 useBodyUnpacker：401 归 UNAUTHORIZED', async () => {
    const transport = upstreamStatus(401, {});
    const call = createCall<TestContext>({ transport });
    const unpack = useBodyUnpacker<Output>();

    await expect(
      call(
        context,
        endpoint({
          responseAdaptor: (_ctx, response) => {
            verifyResponseCode(response);
            return unpack(response);
          },
        }),
        { limit: 100 },
      ),
    ).rejects.toThrow(expect.objectContaining({ errorCode: ApiErrorCodes.UNAUTHORIZED, message: 'HTTP 401' }));
  });
});

describe('createCall 的时限', () => {
  it('不传 timeoutMs：transport 收到的 init 不带 signal', async () => {
    const transport = upstreamOk();
    const call = createCall<TestContext>({ transport });

    await call(context, endpoint(), { limit: 100 });

    expect(transport.mock.calls[0]?.[1]).not.toHaveProperty('signal');
  });

  it('传了 timeoutMs：init 上原有字段保留，signal 是 AbortSignal', async () => {
    const transport = upstreamOk();
    const call = createCall<TestContext>({ transport, timeoutMs: 1_000 });

    await call(context, endpoint(), { limit: 100 });

    const init = transport.mock.calls[0]?.[1];
    expect(init?.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('transport 迟迟不答：到点抛 TIMEOUT，不看接缝抛了什么', async () => {
    vi.useFakeTimers();
    try {
      const transport = upstreamHanging();
      const call = createCall<TestContext>({ transport, timeoutMs: 500 });
      const attempt = call(context, endpoint(), { limit: 100 });
      const rejected = expect(attempt).rejects.toThrow(
        expect.objectContaining({
          errorCode: ApiErrorCodes.TIMEOUT,
          operation: 'listMessages',
          request: expect.objectContaining({ url: MESSAGE_URL }),
        }),
      );

      await vi.advanceTimersByTimeAsync(500);

      await rejected;
      await expect(attempt).rejects.toBeInstanceOf(ApiError);
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('端点的 timeoutMs 覆盖 CallOptions 的', async () => {
    vi.useFakeTimers();
    try {
      const transport = upstreamHanging();
      const call = createCall<TestContext>({ transport, timeoutMs: 500 });
      const attempt = call(context, endpoint({ timeoutMs: 10_000 }), { limit: 100 });
      const rejected = expect(attempt).rejects.toThrow(expect.objectContaining({ errorCode: ApiErrorCodes.TIMEOUT }));

      // CallOptions 的 500ms 到了，端点自己的 10s 还没到，这一次调用不该被中止。
      await vi.advanceTimersByTimeAsync(500);
      expect(transport.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(9_500);

      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it('时限也覆盖非 transport 的等待段：读答复拖过时限也归 TIMEOUT', async () => {
    vi.useFakeTimers();
    try {
      const transport = upstreamOk();
      const call = createCall<TestContext>({ transport, timeoutMs: 500 });
      const read = (): Promise<unknown> => new Promise((resolve) => setTimeout(() => resolve(OK_BODY), 1_000));
      const attempt = call(context, endpoint({ responseBodyReader: read }), { limit: 100 });
      const rejected = expect(attempt).rejects.toThrow(expect.objectContaining({ errorCode: ApiErrorCodes.TIMEOUT, operation: 'listMessages' }));

      await vi.advanceTimersByTimeAsync(1_000);

      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it('调用退出后计时器已清掉', async () => {
    vi.useFakeTimers();
    try {
      const transport = upstreamOk();
      const call = createCall<TestContext>({ transport, timeoutMs: 1_000 });

      await call(context, endpoint(), { limit: 100 });

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
