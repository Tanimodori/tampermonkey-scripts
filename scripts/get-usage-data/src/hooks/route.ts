/**
 * 盯着 SPA 的路径变化。`pushState` / `replaceState` 不触发任何事件，只能自己挂钩；
 * `popstate` / `hashchange` 覆盖浏览器前进后退。注册时会立刻用当前路径回调一次。
 */
export const watchPath = (onChange: (pathname: string) => void): void => {
  const notify = (): void => onChange(location.pathname);

  for (const method of ['pushState', 'replaceState'] as const) {
    const native = history[method];
    history[method] = function (this: History, ...args: Parameters<History['pushState']>): void {
      Reflect.apply(native, this, args);
      notify();
    };
  }

  addEventListener('popstate', notify);
  addEventListener('hashchange', notify);
  notify();
};
