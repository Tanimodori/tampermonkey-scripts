import type { GarlandSearchItem } from 'xiv-api-provider';
import { garland } from '../clients';
import { useCache } from './useCache';

// 按名/图标反查只能靠 garland:国服 xivapi 的 /search 只匹配拉丁文本、且不回图标号。走 gmFetch 绕开 search.php 的 CORS。
const _fetchSearch = async (text: string): Promise<GarlandSearchItem[]> => garland.search({ text, lang: 'en' });

export const { fetch: fetchSearch, cache: searchCache } = useCache(_fetchSearch);
