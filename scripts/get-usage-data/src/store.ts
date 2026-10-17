import { localIso } from './time';

/** 落盘的一条记录：一次被采集到的响应。 */
export interface Package {
  /** 完整的请求 URL，含查询串。 */
  requestUrl: string;
  /** 收到响应的时刻，ISO 8601 带本地时区偏移。 */
  responseTime: string;
  /** 响应体解析出来的 JSON。 */
  data: unknown;
}

/**
 * 按 `requestUrl` 去重：同一个 URL 被反复请求（页面轮询）只留最新那条，
 * 位置按首次采集的顺序。翻页或换时间范围会改变查询串，因此各算一条。
 */
const captured = new Map<string, Package>();
const listeners = new Set<() => void>();
let revision = 0;

export const capture = (requestUrl: string, data: unknown, at: Date): void => {
  captured.set(requestUrl, { requestUrl, responseTime: localIso(at), data });
  revision += 1;
  for (const listener of listeners) listener();
};

export const capturedCount = (): number => captured.size;

/** 采集版本号：与下载时的读数一比，就知道之后有没有新数据进来。 */
export const revisionOf = (): number => revision;

/** 按首次采集的顺序取出全部记录，供落盘。 */
export const snapshot = (): Package[] => [...captured.values()];

export const subscribe = (listener: () => void): void => {
  listeners.add(listener);
};
