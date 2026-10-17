import type { CaptureSink } from './fetch';
import { toUrl } from './fetch';

/** 记在 XHR 实例上的请求 URL。用 Symbol 免得和页面自己的属性撞名。 */
const requestUrl = Symbol('get-usage-data:requestUrl');

interface CapturingXhr extends XMLHttpRequest {
  [requestUrl]?: URL | null;
}

/** 按 `responseType` 取回响应体并解析；拿不到 JSON 就返回 undefined。 */
const readBody = (xhr: XMLHttpRequest): unknown => {
  try {
    if (xhr.responseType === 'json') return xhr.response as unknown;
    if (xhr.responseType === '' || xhr.responseType === 'text') return JSON.parse(xhr.responseText) as unknown;
  } catch {
    // 响应不是 JSON 就不收这一条。
  }
  return undefined;
};

/**
 * 覆写 `XhrClass.prototype` 的 `open` / `send`：命中 `matches` 的请求在 `load` 之后读一份响应体。
 * 前端常用 axios，它默认走 XHR，只拦 fetch 会一条都拿不到。这里只旁听，转发原样，不改写响应。
 */
export const interceptXhr = (XhrClass: typeof XMLHttpRequest, matches: (url: URL) => boolean, sink: CaptureSink): void => {
  const open = XhrClass.prototype.open;
  const send = XhrClass.prototype.send;

  XhrClass.prototype.open = function (this: CapturingXhr, ...args: [string, string | URL, ...unknown[]]): void {
    this[requestUrl] = toUrl(args[1]);
    Reflect.apply(open, this, args);
  };

  XhrClass.prototype.send = function (this: CapturingXhr, ...args: unknown[]): void {
    const url = this[requestUrl];
    if (url && matches(url)) {
      this.addEventListener('load', () => {
        if (this.status < 200 || this.status >= 300) return;
        const data = readBody(this);
        if (data !== undefined) sink(url.href, data);
      });
    }
    Reflect.apply(send, this, args);
  };
};
