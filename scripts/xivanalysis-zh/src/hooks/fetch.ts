// 把 garlands 的 search.php 调用接到异步 `GM.xmlHttpRequest`(Promise 版)。
// garlands 镜像不回 `access-control-allow-origin`,页面 origin 原生 fetch 会被 CORS 拦(实测),只能走 GM 代发;
// 失败/超时/中止都 reject,调用方(data/garland)catch 后降级为"没查到",不影响页面。
// GM 的类型与 `unsafeWindow` 由 src/types/gm.d.ts 全局声明,此处不重复定义。
const parseHeaders = (raw: string): [string, string][] => {
  const out: [string, string][] = [];
  for (const line of raw.split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    out.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
  }
  return out;
};

export const gmFetch = async (url: string, headers?: Record<string, string>): Promise<Response> => {
  const res = await GM.xmlHttpRequest({ method: 'GET', url, headers, responseType: 'text', anonymous: true }); // 网络错误/超时/abort → reject
  return new Response(res.responseText, { status: res.status, statusText: res.statusText, headers: parseHeaders(res.responseHeaders) });
};
