import { describe, expect, it, vi } from 'vitest';
import { interceptXhr } from '@/hooks/xhr';

const USAGE = 'https://platform.deepseek.com/api/v0/usage/by_api_key/amount?start=1789660800';
const matches = (url: URL): boolean => url.pathname.startsWith('/api/v0/usage/');

/** 每个用例一份新类：`interceptXhr` 改的是原型，共用会串味。 */
class FakeXhr extends EventTarget {
  status = 0;
  responseType: XMLHttpRequestResponseType = '';
  responseText = '';
  response: unknown = null;
  opened: unknown[] = [];
  sent: unknown[] = [];

  open(...args: unknown[]): void {
    this.opened = args;
  }

  send(...args: unknown[]): void {
    this.sent = args;
  }

  /** 模拟响应到达：写好状态与响应体，再抛一个 `load`。 */
  respond(status: number, body: unknown): void {
    this.status = status;
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
    this.dispatchEvent(new Event('load'));
  }
}

const intercept = (sink: (url: string, data: unknown) => void): typeof FakeXhr => {
  interceptXhr(FakeXhr as unknown as typeof XMLHttpRequest, matches, sink);
  return FakeXhr;
};

describe('interceptXhr', () => {
  it('命中时在 load 之后采集', () => {
    const sink = vi.fn();
    const Xhr = intercept(sink);
    const xhr = new Xhr();

    xhr.open('GET', USAGE);
    xhr.send();
    xhr.respond(200, { total: 3 });

    expect(sink).toHaveBeenCalledWith(USAGE, { total: 3 });
  });

  it('未命中的请求不采集', () => {
    const sink = vi.fn();
    const Xhr = intercept(sink);
    const xhr = new Xhr();

    xhr.open('GET', 'https://platform.deepseek.com/api/v0/users/current');
    xhr.send();
    xhr.respond(200, { user: 1 });

    expect(sink).not.toHaveBeenCalled();
  });

  it('非 2xx 不采集', () => {
    const sink = vi.fn();
    const Xhr = intercept(sink);
    const xhr = new Xhr();

    xhr.open('GET', USAGE);
    xhr.send();
    xhr.respond(500, { error: 'boom' });

    expect(sink).not.toHaveBeenCalled();
  });

  it('responseType 为 json 时读 response', () => {
    const sink = vi.fn();
    const Xhr = intercept(sink);
    const xhr = new Xhr();

    xhr.open('GET', USAGE);
    xhr.send();
    xhr.responseType = 'json';
    xhr.response = { total: 9 };
    xhr.respond(200, '');

    expect(sink).toHaveBeenCalledWith(USAGE, { total: 9 });
  });

  it('响应不是 JSON 就不采集，也不抛', () => {
    const sink = vi.fn();
    const Xhr = intercept(sink);
    const xhr = new Xhr();

    xhr.open('GET', USAGE);
    xhr.send();

    expect(() => xhr.respond(200, '<html>')).not.toThrow();
    expect(sink).not.toHaveBeenCalled();
  });

  it('open / send 的参数原样转发', () => {
    const Xhr = intercept(() => {});
    const xhr = new Xhr();

    xhr.open('POST', USAGE, true, 'user', 'pass');
    xhr.send('body');

    expect(xhr.opened).toEqual(['POST', USAGE, true, 'user', 'pass']);
    expect(xhr.sent).toEqual(['body']);
  });
});
