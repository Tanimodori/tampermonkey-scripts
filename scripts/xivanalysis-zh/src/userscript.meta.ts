// 用户脚本元数据。vite.config.ts 与元数据测试共用这一份，避免两处漂移。
export const USERSCRIPT_META = {
  name: { default: 'xivanalysis-zh', zh: 'xivanalysis 中文补全' },
  description: {
    default: 'Fill in the missing Chinese translations for xivanalysis',
    zh: '为 xivanalysis 填补缺失的中文翻译',
  },
  namespace: 'http://tanimodori.com/',
  match: 'https://xivanalysis.com/*',
  include: 'https://xivanalysis.com/*',
  // 截获并改写宿主页 fetch(unsafeWindow)。CN 读走原生 fetch(国服回 ACAO:*);
  // 仅 garlands search.php 兜底无 CORS 头,须经 GM → 保留 GM_xmlhttpRequest + @connect。
  grant: ['GM_xmlhttpRequest', 'unsafeWindow'],
  connect: ['www.garlandtools.cn'],
  'run-at': 'document-start',
};
