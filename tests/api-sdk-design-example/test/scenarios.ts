import { expect } from 'vitest';
import { createApi } from '@/index';
import { API_BASE, GOOD_OUTPUT, INPUT, TOKEN, failure, testEndpoint } from './fixtures';
import { upstreamEnvelope, upstreamOk, upstreamRateLimited, upstreamServerError, upstreamUnreachable } from './upstream';

/**
 * 本项目重心的一半：一次调用的错误处理。同一个下场在带 zod 与不带 zod 两份装配上各成立一次，所以这张表只写一遍，
 * 由两份 spec 各自拿去跑——用例清单里两份装配因此都点得到名。
 *
 * 上游只由 `upstream.ts` 的 mock fetch 扮演。client 不递 transport：`fetch` 已被顶替，调用时就地读那一份。
 */

const api = createApi({ apiBase: API_BASE, token: TOKEN });

/** 一个下场：`run` 自己装上游、调用、断言，收下的是被测的那一份装配。 */
export interface Scenario {
  readonly label: string;
  readonly run: (endpoint: typeof testEndpoint.withZod) => Promise<void>;
}

export const SCENARIOS: readonly Scenario[] = [
  {
    label: '正常且凭据有效',
    run: async (endpoint) => {
      upstreamOk({ accept: `Bearer ${TOKEN}`, data: GOOD_OUTPUT });
      await expect(api.call(endpoint, INPUT)).resolves.toEqual(GOOD_OUTPUT);
    },
  },
  {
    label: '凭据被拒',
    run: async (endpoint) => {
      const fetchMock = upstreamOk({ accept: 'Bearer a.different.token', data: GOOD_OUTPUT });
      const error = await failure(api.call(endpoint, INPUT));
      expect(error.errorCode).toBe('UNAUTHORIZED');
      expect(error.message).toBe('HTTP 401');
      expect(error.request?.url).toBe('https://example.com/api/message?limit=100');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  },
  {
    // `Retry-After` 不由库解析：它就原样躺在 `response.headers` 上（见 docs/error-handling.md 的「重试提示原样留着」），
    // 这一例钉住的是「原样保留」，而不是某个解析结果。
    label: '限流',
    run: async (endpoint) => {
      upstreamRateLimited({ 'retry-after': '7' });
      const error = await failure(api.call(endpoint, INPUT));
      expect(error.errorCode).toBe('RATE_LIMIT');
      expect(error.message).toBe('HTTP 429');
      expect(error.response?.headers['retry-after']).toBe('7');
    },
  },
  {
    label: '服务器错误',
    run: async (endpoint) => {
      upstreamServerError();
      const error = await failure(api.call(endpoint, INPUT));
      expect(error.errorCode).toBe('SERVER_ERROR');
      expect(error.message).toBe('HTTP 500');
      expect(error.response?.status).toBe(500);
    },
  },
  {
    label: '不可达',
    run: async (endpoint) => {
      upstreamUnreachable(new Error('socket hang up'));
      const error = await failure(api.call(endpoint, INPUT));
      expect(error.errorCode).toBe('NETWORK_ERROR');
      expect(error.message).toBe('socket hang up');
      expect(error.request?.url).toBe('https://example.com/api/message?limit=100');
    },
  },
  {
    label: 'HTTP 200 配业务失败码',
    run: async (endpoint) => {
      upstreamEnvelope({ code: 401, msg: 'token expired' });
      const error = await failure(api.call(endpoint, INPUT));
      expect(error.errorCode).toBe('BAD_REQUEST');
      expect(error.message).toBe('token expired');
      expect(error.operation).toBe('listMessages');
      expect(error.request?.url).toBe('https://example.com/api/message?limit=100');
    },
  },
];
