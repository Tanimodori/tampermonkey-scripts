import type { FetcherResponse, WebFetcherRequestInit } from 'universal-fetch-type';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, ApiErrorCodes, createCall } from '@/index';
import type { ApiRequest, ApiResponse, Endpoint } from '@/index';
import { BASE_URL, CSV_BODY } from './fixtures';

/**
 * 端点的两条读法：`responseBodyReader` 只换 body（状态与头字段仍由 `createCall` 取），`responseReader` 连
 * 状态与头字段一起重写；两条都不给时行为与从前一致。上游只由本文件的自定义 fetch 扮演。
 */

interface TestContext {
  readonly base: string;
}

const context: TestContext = { base: BASE_URL };

/** 纯文本的答复，`responseBodyReader` 要读的就是它。 */
function upstreamText(body = CSV_BODY, status = 200, headers: Record<string, string> = {}) {
  return vi.fn(async (url: string, _init?: WebFetcherRequestInit): Promise<Response> => {
    new URL(url);
    return new Response(body, { status, headers: { 'content-type': 'text/csv', ...headers } });
  });
}

const endpoint = (overrides: Partial<Endpoint<TestContext, undefined, unknown>> = {}): Endpoint<TestContext, undefined, unknown> => ({
  operation: 'fetchText',
  requestAdaptor: (ctx): ApiRequest => ({ url: new URL('/sheet.csv', ctx.base).href, init: {} }),
  responseAdaptor: (_ctx, response) => response.body,
  ...overrides,
});

describe('responseBodyReader', () => {
  it('换掉 body 的读法，状态与头字段仍由 createCall 取', async () => {
    const transport = upstreamText(CSV_BODY, 200, { 'x-trace': 'abc' });
    const call = createCall<TestContext>({ transport });
    const read = vi.fn((_ctx: TestContext, response: FetcherResponse) => response.text());

    const out = await call(context, endpoint({ responseBodyReader: read }), undefined);

    expect(out).toBe(CSV_BODY);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read.mock.calls[0]?.[0]).toBe(context);
    expect(read.mock.calls[0]?.[1]).toBeInstanceOf(Response);
  });

  it('缺省仍是 raw.json()：不写读法的端点行为不变', async () => {
    const transport = upstreamText(JSON.stringify({ code: 0, data: 7 }), 200, { 'content-type': 'application/json' });
    const call = createCall<TestContext>({ transport });
    const responseAdaptor = vi.fn((_ctx: TestContext, response: ApiResponse): unknown => response);

    const response = (await call(context, endpoint({ responseAdaptor }), undefined)) as ApiResponse;

    expect(response).toEqual({ status: 200, headers: { 'content-type': 'application/json' }, body: { code: 0, data: 7 } });
  });

  it('读法可以返回非 Promise 的值', async () => {
    const transport = upstreamText();
    const call = createCall<TestContext>({ transport });

    await expect(call(context, endpoint({ responseBodyReader: (_ctx, response) => response.status }), undefined)).resolves.toBe(200);
  });

  it('读法抛出的错误归 NETWORK_ERROR，request 留在错误上', async () => {
    const transport = upstreamText();
    const call = createCall<TestContext>({ transport });
    const read = (): string => {
      throw new Error('empty body');
    };

    await expect(call(context, endpoint({ responseBodyReader: read }), undefined)).rejects.toThrow(
      expect.objectContaining({
        errorCode: ApiErrorCodes.NETWORK_ERROR,
        message: 'empty body',
        operation: 'fetchText',
        request: expect.objectContaining({ url: `${BASE_URL}/sheet.csv` }),
      }),
    );
  });

  it('读法抛出的 ApiError 原样上抛，只补缺的字段', async () => {
    const custom = new ApiError({ errorCode: 'EMPTY_BODY', message: 'empty body' });
    const transport = upstreamText();
    const call = createCall<TestContext>({ transport });
    const attempt = call(
      context,
      endpoint({
        responseBodyReader: () => {
          throw custom;
        },
      }),
      undefined,
    );

    await expect(attempt).rejects.toBe(custom);
    expect(custom.operation).toBe('fetchText');
    expect(custom.request).toEqual(expect.objectContaining({ url: `${BASE_URL}/sheet.csv` }));
  });
});

describe('responseReader', () => {
  it('整份答复由它定下：状态、头字段与 body 都取自读法', async () => {
    const transport = upstreamText();
    const call = createCall<TestContext>({ transport });
    const read = vi.fn(async (_ctx: TestContext, _response: FetcherResponse): Promise<ApiResponse> => ({
      status: 418,
      headers: { 'x-from-reader': 'yes' },
      body: 'teapot',
    }));

    await expect(call(context, endpoint({ responseReader: read }), undefined)).resolves.toBe('teapot');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('两条都给时 responseReader 说话，responseBodyReader 不参与', async () => {
    const transport = upstreamText();
    const call = createCall<TestContext>({ transport });
    const bodyReader = vi.fn((_ctx: TestContext, response: FetcherResponse) => response.text());

    const out = await call(
      context,
      endpoint({
        responseBodyReader: bodyReader,
        responseReader: (_ctx, response): ApiResponse => ({ status: response.status, headers: {}, body: 'from reader' }),
      }),
      undefined,
    );

    expect(out).toBe('from reader');
    expect(bodyReader).not.toHaveBeenCalled();
  });

  it('读法抛出的错误同样归 NETWORK_ERROR', async () => {
    const transport = upstreamText();
    const call = createCall<TestContext>({ transport });
    const read = async (): Promise<ApiResponse> => {
      throw new Error('body never arrived');
    };

    await expect(call(context, endpoint({ responseReader: read }), undefined)).rejects.toThrow(
      expect.objectContaining({ errorCode: ApiErrorCodes.NETWORK_ERROR, message: 'body never arrived', operation: 'fetchText' }),
    );
  });
});
