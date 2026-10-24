import { describe, expect, it, vi } from 'vitest';
import { createGmFetch, parseHeaders } from '../../src/hooks/fetch';

const gmResponse = (overrides: Partial<GMXMLHttpResponse> = {}): GMXMLHttpResponse => ({
  status: 200,
  statusText: 'OK',
  readyState: 4,
  responseHeaders: 'content-type: application/json\r\nx-test: yes',
  response: null,
  responseText: '{"ok":true}',
  responseXML: null,
  finalUrl: 'https://www.garlandtools.cn/api/search.php',
  context: undefined,
  ...overrides,
});

describe('parseHeaders', () => {
  it('按冒号拆分行，忽略没有冒号的行', () => {
    expect(parseHeaders('content-type: application/json\r\nx-test: yes\r\nbroken')).toEqual([
      ['content-type', 'application/json'],
      ['x-test', 'yes'],
    ]);
  });
});

describe('createGmFetch', () => {
  it('把 GM 响应包装成 Response，并透传请求细节', async () => {
    const request = vi.fn(async () => gmResponse());
    const fetchImpl = createGmFetch(request);

    const res = await fetchImpl('https://www.garlandtools.cn/api/search.php?text=Fire', { accept: 'application/json' });

    expect(request).toHaveBeenCalledWith({
      method: 'GET',
      url: 'https://www.garlandtools.cn/api/search.php?text=Fire',
      headers: { accept: 'application/json' },
      responseType: 'text',
      anonymous: true,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-test')).toBe('yes');
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it('GM 失败时 reject', async () => {
    const fetchImpl = createGmFetch(async () => {
      throw new Error('network error');
    });

    await expect(fetchImpl('https://www.garlandtools.cn/api/search.php?text=Fire')).rejects.toThrow('network error');
  });
});
