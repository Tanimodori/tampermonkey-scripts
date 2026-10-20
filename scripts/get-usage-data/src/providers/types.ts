/** 一家服务商：决定按钮出现在哪些页面、哪些响应要被收下。 */
export interface Provider {
  /** 写进文件名，如 `usage-deepseek-20261017-150405.json` 里的 `deepseek`。 */
  readonly id: string;
  /** 出现按钮的页面路径，与 `location.pathname` 比对；字符串按字面比，正则匹配整条路径。 */
  readonly pagePath: string | RegExp;
  /** 命中即采集这个响应。 */
  matchesRequest(url: URL): boolean;
}

/** 页面路径比对：只忽略结尾的斜杠；字符串按字面比，正则匹配整条路径。 */
export const isOnPage = (provider: Provider, pathname: string): boolean => {
  const path = pathname.replace(/\/+$/, '');
  const { pagePath } = provider;
  return typeof pagePath === 'string' ? path === pagePath : pagePath.test(path);
};

/** 找出当前路径归属的服务商；不在任何服务商的用量页上时返回 undefined。 */
export const providerOn = (providers: readonly Provider[], pathname: string): Provider | undefined =>
  providers.find((provider) => isOnPage(provider, pathname));
