// 图标取自 Iconify 的 mdi 集合。vite.config.ts 里 unplugin-icons 配了 `compiler: 'raw'`，
// 这些 import 拿到的就是 SVG 源码字符串，构建时内联进产物，运行时零依赖。
import check from '~icons/mdi/check';
import download from '~icons/mdi/download';
import loading from '~icons/mdi/loading';

export const icons = { loading, download, check } as const;
