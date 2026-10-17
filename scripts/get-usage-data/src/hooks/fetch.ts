/** 采集回调：一个命中请求的完整 URL，加上已经解析好的响应体。 */
export type CaptureSink = (requestUrl: string, data: unknown) => void;

/** 把 fetch 的入参还原成绝对 URL；还原不出来就当没命中，原样放行。 */
export const toUrl = (input: string | URL | { url: string }): URL | null => {
  try {
    if (input instanceof URL) return input;
    return new URL(typeof input === 'string' ? input : input.url, document.baseURI);
  } catch {
    return null;
  }
};

/** 只读一份响应体副本；不是 JSON（或已被消费）就返回 undefined，绝不抛。 */
const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

/**
 * 覆写 `target.fetch`：命中 `matches` 的响应在交回页面之前拷一份读出来。
 * 页面拿到的仍是原来那个 `Response`，响应体没被我们动过；非 2xx 与非 JSON 一律不采集，
 * 也不吞掉任何错误——原 Promise 的拒绝照旧传给页面。
 */
export const interceptFetch = (target: { fetch: typeof globalThis.fetch }, matches: (url: URL) => boolean, sink: CaptureSink): void => {
  const nativeFetch = target.fetch;
  target.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = toUrl(input);
    if (!url || !matches(url)) return nativeFetch.call(this, input, init);

    return nativeFetch.call(this, input, init).then((response) => {
      if (response.ok) {
        // clone 得在这一拍同步做掉：页面随后的读取会消费掉原响应体，那时再拷就晚了。
        const copy = response.clone();
        void readJson(copy).then((data) => {
          if (data !== undefined) sink(url.href, data);
        });
      }
      return response;
    });
  };
};
