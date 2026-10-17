import type { Package } from './store';
import { localStamp } from './time';

/** 落盘文件名，形如 `usage-deepseek-20261017-150405.json`。 */
export const fileNameOf = (providerId: string, date: Date): string => `usage-${providerId}-${localStamp(date)}.json`;

/** 把记录写成 JSON 交给浏览器下载。走 Blob + `<a download>`，不需要 GM 的下载 API。 */
export const downloadJson = (fileName: string, packages: Package[]): void => {
  const blob = new Blob([JSON.stringify(packages, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  // Firefox 只对挂在文档里的节点触发下载。
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 下载已经接手这份 URL，稍后回收即可；立刻撤会打断还没读到的浏览器。
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
