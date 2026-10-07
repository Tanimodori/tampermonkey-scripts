import type { GarlandActionResponse, GarlandDocKind, GarlandItemResponse, GarlandSearchItem, GarlandStatusResponse } from './types/schema';

/**
 * Garland 镜像的运行时检查：普通函数，没有 schema 引擎。
 *
 * 两份装配都用它们判定响应；verified 端点会额外把投影后的文档按 `./types/schema.ts` 解析一次，更严的形状住在
 * 那里。
 */

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** 每种文档的负载键，一个 client 知道这一条就够信任一份文档。 */
const DOCUMENT_KEY: Record<GarlandDocKind, keyof never | string> = { item: 'item', action: 'action', status: 'status' };

export const isGarlandDocument = <K extends GarlandDocKind>(
  kind: K,
  body: unknown,
): body is GarlandItemResponse | GarlandActionResponse | GarlandStatusResponse => {
  const key = DOCUMENT_KEY[kind];
  return isRecord(body) && isRecord(body[key as string]) && typeof (body[key as string] as { id?: unknown }).id === 'number';
};

export const isGarlandSearchResults = (body: unknown): body is GarlandSearchItem[] =>
  Array.isArray(body) && body.every((hit) => isRecord(hit) && typeof hit.id === 'string' && isRecord(hit.obj));

/**
 * 一份文档说的是不是这件物品可以上市。
 *
 * 不可上市的物品上 `tradeable` 是整个键缺席，而不是等于 `0`，所以缺席本身就是答案，这也是它写成函数而不是调用点
 * 的 `Boolean(item.tradeable)` 的原因。
 */
export const isGarlandTradeable = (item: { tradeable?: unknown }): boolean => item.tradeable === 1;

/** 一条命中的数字编号。用它，不要用 `hit.id`，那是字符串。 */
export const garlandHitId = (hit: GarlandSearchItem): number => hit.obj.i;

/** 一条命中指向的种类，只在这个包知道怎么取它的文档时给出。 */
export const garlandHitKind = (hit: GarlandSearchItem): GarlandDocKind | null => {
  const kind = hit.type;
  return kind === 'item' || kind === 'action' || kind === 'status' ? kind : null;
};

/**
 * 一段文本是否用非英语索引能匹配的字形写成。
 *
 * `search.php` 拿 `text` 去匹配 `lang` 指名的语言，所以英文词配 `lang=chs` 答的是 `[]` 而不是一个错误，这是搜索框
 * 最糟的失败模式：没有任何东西能区分「没有这个东西」与「你用了不对的检索语言」。
 *
 * 区段写成转义是因为事实是码位而不是字形，字面写出来的 `豈-﫿` 读起来是一块，实际跨 U+8C48–U+FAFF，除汉字之外还
 * 盖进了彝文、谚文字母扩展 B 与它们之间未分配的间隙。CJK 扩展 B 及以后（U+20000 起）在 `\uXXXX` 写法之外，因此
 * 读作非 CJK。
 */
const CJK = /[\u3041-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7a3\uf900-\ufaff]/;

export const looksCjk = (text: string): boolean => CJK.test(text);

/** 在调用方偏好的语种里挑一个能回答 `text` 的 `lang`。 */
export const garlandLangFor = (text: string, preferred: 'chs' | 'ja' | 'en' | 'de' | 'fr' = 'chs'): 'chs' | 'ja' | 'en' | 'de' | 'fr' =>
  looksCjk(text) ? preferred : 'en';
