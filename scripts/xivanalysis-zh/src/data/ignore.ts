// 兜底记录:resolve 链全部未命中、且 detector 显式开启 warn 时上报一次。去重后收集,供调试查阅。
const warned = new Set<string>();

export const reportUntranslated = (text: string): void => {
  const t = text.trim();
  if (!t || warned.has(t)) return;
  warned.add(t);
  console.warn('[xiv-warn] 未覆盖英文:', JSON.stringify(t));
};

export const untranslatedList = (): string[] => [...warned].sort();
