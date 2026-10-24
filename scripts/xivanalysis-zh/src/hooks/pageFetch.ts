// 页面原生 fetch 的惰性捕获。document-start 时先存下原生实现，之后 injectFetch 覆写
// unsafeWindow.fetch，国服读与 garland 单行读仍走原生函数，不会递归到被覆写的版本。
// 测试与其它入口若没有调用 initPageFetch，就在首次调用时从 unsafeWindow（或 globalThis）取一次。
let native: typeof globalThis.fetch | undefined;

export const initPageFetch = (win: Window & typeof globalThis): void => {
  native = win.fetch.bind(win);
};

export const pageFetch: typeof globalThis.fetch = (input, init) => {
  if (!native) {
    const win = (globalThis as { unsafeWindow?: Window & typeof globalThis }).unsafeWindow ?? globalThis;
    native = win.fetch.bind(win);
  }
  return native(input, init);
};
