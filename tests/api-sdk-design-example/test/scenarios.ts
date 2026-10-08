import { expect } from 'vitest';
import type { ListMessagesInput, ListMessagesOutput } from '@/endpoints/schema';
import { createApi } from '@/index';
import type { Api, Endpoint } from '@/index';
import { API_BASE, GOOD_OUTPUT, INPUT, TOKEN } from './fixtures';
import { upstreamEnvelope, upstreamOk, upstreamRateLimited, upstreamServerError, upstreamUnreachable } from './upstream';

/**
 * 一次调用的错误处理，同一个场景在带校验与无校验两侧各成立一次。这张表只写一遍，两侧各自拿去跑。
 *
 * 上游只由 `upstream.ts` 的自定义 fetch 扮演，每例现装一份，当 `transport` 递给这一次的 client，不碰全局。
 */

const MESSAGE_URL = 'https://example.com/api/message?limit=100';

/** 一个场景，`run` 自己装上游、调用、断言，收下的是被测的那一份装配。 */
export interface Scenario {
  readonly label: string;
  readonly run: (endpoint: Endpoint<Api, ListMessagesInput, ListMessagesOutput>) => Promise<void>;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    label: '正常且凭据有效',
    run: async (endpoint) => {
      const api = createApi({ apiBase: API_BASE, token: TOKEN, transport: upstreamOk({ accept: `Bearer ${TOKEN}`, data: GOOD_OUTPUT }) });
      await expect(api.call(endpoint, INPUT)).resolves.toEqual(GOOD_OUTPUT);
    },
  },
  {
    label: '凭据被拒',
    run: async (endpoint) => {
      const transport = upstreamOk({ accept: 'Bearer a.different.token', data: GOOD_OUTPUT });
      const api = createApi({ apiBase: API_BASE, token: TOKEN, transport });
      await expect(api.call(endpoint, INPUT)).rejects.toThrow(
        expect.objectContaining({
          errorCode: 'UNAUTHORIZED',
          message: 'unauthorized',
          request: expect.objectContaining({ url: MESSAGE_URL }),
        }),
      );
      expect(transport).toHaveBeenCalledTimes(1);
    },
  },
  {
    // `Retry-After` 不由库解析，原样留在 `response.headers` 上。这一例钉住原样保留。
    label: '限流',
    run: async (endpoint) => {
      const api = createApi({ apiBase: API_BASE, token: TOKEN, transport: upstreamRateLimited({ 'retry-after': '7' }) });
      await expect(api.call(endpoint, INPUT)).rejects.toThrow(
        expect.objectContaining({
          errorCode: 'RATE_LIMIT',
          message: 'too many requests',
          response: expect.objectContaining({ headers: expect.objectContaining({ 'retry-after': '7' }) }),
        }),
      );
    },
  },
  {
    label: '服务器错误',
    run: async (endpoint) => {
      const api = createApi({ apiBase: API_BASE, token: TOKEN, transport: upstreamServerError() });
      await expect(api.call(endpoint, INPUT)).rejects.toThrow(
        expect.objectContaining({
          errorCode: 'SERVER_ERROR',
          message: 'internal',
          response: expect.objectContaining({ status: 500 }),
        }),
      );
    },
  },
  {
    label: '不可达',
    run: async (endpoint) => {
      const api = createApi({
        apiBase: API_BASE,
        token: TOKEN,
        transport: upstreamUnreachable(new Error('socket hang up')),
      });
      await expect(api.call(endpoint, INPUT)).rejects.toThrow(
        expect.objectContaining({
          errorCode: 'NETWORK_ERROR',
          message: 'socket hang up',
          request: expect.objectContaining({ url: MESSAGE_URL }),
        }),
      );
    },
  },
  {
    label: 'HTTP 200 配业务失败码',
    run: async (endpoint) => {
      const api = createApi({
        apiBase: API_BASE,
        token: TOKEN,
        transport: upstreamEnvelope({ code: 401, msg: 'token expired' }),
      });
      await expect(api.call(endpoint, INPUT)).rejects.toThrow(
        expect.objectContaining({
          errorCode: 'BAD_REQUEST',
          message: 'token expired',
          operation: 'listMessages',
          request: expect.objectContaining({ url: MESSAGE_URL }),
        }),
      );
    },
  },
];
