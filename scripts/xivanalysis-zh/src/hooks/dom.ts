// document-start 下 `document.head` 与 `document.body` 都还不存在（实测：Tampermonkey 的
// `@run-at document-start` 与 Playwright 的 `addInitScript` 都是如此）。这里等目标节点出现再执行回调：
// 先挂到 document 上观察，节点一到就摘掉观察者。同步调用点因此不需要自己判空。
export const whenNodeReady = (pick: () => Node | null, run: (node: Node) => void): void => {
  const existing = pick();
  if (existing) {
    run(existing);
    return;
  }
  const observer = new MutationObserver(() => {
    const node = pick();
    if (!node) return;
    observer.disconnect();
    run(node);
  });
  observer.observe(document, { childList: true, subtree: true });
};
