import type { FetchLike } from 'xiv-api-provider';
import type { Package, PackageInjector } from './types';

// Hooks。声明 @grant 后脚本进沙箱,`window` 不是宿主页那个;要截获页面请求必须读写 `unsafeWindow.fetch`。
export const origFetch: FetchLike = unsafeWindow.fetch.bind(unsafeWindow) as FetchLike;

export const injectFetch = (injector: PackageInjector): void => {
  unsafeWindow.fetch = async (...args: Parameters<Window['fetch']>) => {
    const response = await origFetch(...(args as [RequestInfo, RequestInit | undefined]));
    let json: unknown;
    try {
      json = await response.clone().json();
    } catch {
      return response; // 非 JSON(资源等)原样放行,不改写也不让页面 fetch 失败。
    }
    return injector({ url: args[0].toString(), response, json: json as Package['json'] });
  };
};
