// `GM_xmlhttpRequest` 的类型,依 Tampermonkey / Greasemonkey 官方文档手写(本环境无 @types)。
//
// 同步 vs 异步签名不同,这里只声明**异步**那一个(本脚本用它):
//  - `GM_xmlhttpRequest(details)`(小写 h):回调式异步,返回带 `abort()` 的句柄。details 见 GMXHROptions。
//  - 旧 Greasemonkey 的 `GM_xmlHttpRequest`(大写 H)是**同步**、按位置传参的遗留 API(method, url, ...),已废弃,
//    不声明、不使用。Tampermonkey 另有 `synchronous: true` 选项可让异步 API 同步阻塞,默认 false。
//
// 响应对象见 GMXHRResponse;`responseText` 是文本正文,`responseHeaders` 是原始头字符串("Key: value" 每行一条)。
interface GMXHRResponse {
  readonly readyState: number;
  readonly status: number;
  readonly statusText: string;
  readonly responseHeaders: string;
  readonly response: unknown;
  readonly responseText: string;
  readonly responseXML: Document | null;
  readonly context: unknown;
}

interface GMXHRProgress extends GMXHRResponse {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
}

interface GMXHROptions {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  data?: string | ArrayBuffer | Blob | FormData | Uint8Array | Record<string, unknown> | null;
  binary?: boolean;
  timeout?: number;
  context?: unknown;
  responseType?: 'arraybuffer' | 'blob' | 'document' | 'stream' | 'text';
  overrideMimeType?: string;
  anonymous?: boolean;
  synchronous?: boolean;
  username?: string;
  password?: string;
  onabort?: () => void;
  onerror?: (response: GMXHRResponse) => void;
  onload: (response: GMXHRResponse) => void;
  onloadstart?: (response: GMXHRResponse) => void;
  onloadend?: (response: GMXHRResponse) => void;
  onprogress?: (response: GMXHRProgress) => void;
  onreadystatechange?: (response: GMXHRResponse) => void;
  ontimeout?: (response: GMXHRResponse) => void;
}

interface GMXHRHandle {
  abort(): void;
}

/** 异步、回调式;`@grant GM_xmlhttpRequest` 后可用。 */
declare function GM_xmlhttpRequest(details: GMXHROptions): GMXHRHandle;

/** 宿主页真实 window;`@grant unsafeWindow` 后可用。覆写页面 fetch 必须经它,沙箱的 window 不是页面那个。 */
declare const unsafeWindow: Window & typeof globalThis;
