// 把 `xiv-api-provider` 要的 `FetchLike` 接到异步的 `GM.xmlHttpRequest`(Promise 版)上。
//
// 为什么要它:`@grant none` 下脚本只能用宿主页的 fetch,跨源取 garland / 国服 xivapi 会被目标站的 CORS 拦掉
// (实测 garland `search.php` 无 `Access-Control-Allow-Origin`,报 CORS 阻断)。GM.xmlHttpRequest 走扩展代发,
// 不受页面 origin 的 CORS 约束,是这个 userscript 唯一的跨源出站手段。
import type { FetchLike } from 'xiv-api-provider';

const urlOf = (input: string | URL | Request): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

/** GM 给的是原始响应头字符串,拆成 `new Response` 能吃的 [name, value][]。 */
const parseHeaders = (raw: string): [string, string][] => {
  const out: [string, string][] = [];
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    out.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
  }
  return out;
};

const headerRecord = (input: string | URL | Request, init?: RequestInit): Record<string, string> => {
  const headers: Record<string, string> = {};
  // Request 自带的头先收下,init.headers 若给出则覆盖(与 fetch 语义一致)。
  if (input instanceof Request) {
    input.headers.forEach((value, key) => {
      headers[key] = value;
    });
  }
  const h = init?.headers;
  if (!h) return headers;
  if (typeof Headers !== 'undefined' && h instanceof Headers) {
    h.forEach((value, key) => {
      headers[key] = value;
    });
  } else if (Array.isArray(h)) {
    for (const [key, value] of h) headers[key] = value;
  } else {
    Object.assign(headers, h);
  }
  return headers;
};

export const gmFetch: FetchLike = async (input, init) => {
  const url = urlOf(input);
  const details: GMXMLHttpRequestDetails = {
    method: (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase(),
    url,
    headers: headerRecord(input, init),
    // 只转发 init.body;`Request` 自带的 body(异步流)不读——provider 只做 GET,从不发体请求。
    data: (init?.body ?? null) as GMXMLHttpRequestDetails['data'],
    responseType: 'text',
    anonymous: true, // 对齐 provider 的 `credentials: 'omit'`:不带目标域 Cookie
  };

  const promise = GM.xmlHttpRequest(details);
  const signal = init?.signal;
  const onAbort = signal ? () => promise.abort() : undefined;
  if (signal) {
    if (signal.aborted) promise.abort();
    else signal.addEventListener('abort', onAbort!, { once: true });
  }

  try {
    // 网络错误 / 超时 / abort 都由 promise reject 冒出,符合 fetch 语义。
    const res = await promise;
    return new Response(res.responseText, { status: res.status, statusText: res.statusText, headers: parseHeaders(res.responseHeaders) });
  } finally {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
};
