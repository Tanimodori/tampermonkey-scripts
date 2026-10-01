export type XivKind = 'action' | 'status' | 'item' | 'addon' | 'unknown';

export interface XivEntry {
  kind: XivKind;
  id: number; // 未知(无 xivapi row_id)用 -1
  en: string;
  zh: string;
  iconId?: number;
  modifier?: (el: HTMLElement) => void; // 特殊 DOM 渲染,优先于 zh
}

export type XivDetectorHandler = (element: HTMLElement, input: XivEntry) => void;
export type XivDetectorRescan = () => void;
export type XivDetector = (handler: XivDetectorHandler) => XivDetectorRescan;

// 一次性 bulk 来源:异步产出全部条目(如 garland/jobAbbr/override 这类)。经 providerToSearch 适配成 XivSearch 入 resolve,不做特例。
export type XivEntryProvider = () => Promise<XivEntry[]>;

// 查询:Partial<XivEntry> 决定按哪些字段匹配(id > iconId > en > zh)。
export type XivQuery = Partial<XivEntry>;

// 未命中上报:由 detector 提供,置于 resolve 链末。必须始终成功返回 `Promise<XivEntry[]>`(约定返回 []),
// 只上报、不产条目 —— 保证未命中时 resolve 得到空数组,handler 不会被伪条目调用。
export type XivWarnHandler = (query: XivQuery) => Promise<XivEntry[]>;

// resolver 的统一来源:按查询反查,返回命中数组(空数组=未命中)。匹配优先级 id > iconId > en > zh,kind 仅用于消歧。
export type XivSearch = (query: XivQuery) => Promise<XivEntry[]>;
