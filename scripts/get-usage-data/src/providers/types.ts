/** 一家服务商：决定按钮出现在哪些页面、哪些响应要被收下。 */
export interface Provider {
  /** 写进文件名，如 `usage-deepseek-20261017-150405.json` 里的 `deepseek`。 */
  readonly id: string;
  /** 出现按钮的页面路径，与 `location.pathname` 比对。 */
  readonly pagePath: string;
  /** 命中即采集这个响应。 */
  matchesRequest(url: URL): boolean;
}

/** 页面路径比对：只忽略结尾的斜杠，其余按字面比。 */
export const isOnPage = (provider: Provider, pathname: string): boolean => pathname.replace(/\/+$/, '') === provider.pagePath;
