// Tampermonkey 官方对 `GM_xmlhttpRequest` 提供了两种签名,这里都声明,并注明运行时用哪一套(供本项目及别的项目复用):
//  - **异步(Promise 版)`GM.xmlHttpRequest`**(命名空间、大写 H):`details => Promise`,该 Promise 另带 `abort()`;
//    网络错误 / 超时 / 中止都走 reject。
//  - 回调式(旧版)`GM_xmlhttpRequest`(全局函数):同步发起、靠 onload/onerror 等回调收结果,返回带 `abort()` 的句柄。
// `@grant` 写 `GM_xmlhttpRequest`,`@connect` 的域名限制对两者都适用。纯声明,不进产物、不增体积。

interface GMXMLHttpRequestDetails {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  data?: string | ArrayBuffer | Blob | FormData | Uint8Array | Record<string, unknown> | null;
  binary?: boolean;
  timeout?: number;
  responseType?: 'arraybuffer' | 'blob' | 'document' | 'stream' | 'text';
  overrideMimeType?: string;
  anonymous?: boolean;
  user?: string;
  password?: string;
  context?: unknown;
}

interface GMXMLHttpResponse {
  readonly status: number;
  readonly statusText: string;
  readonly readyState: number;
  readonly responseHeaders: string;
  readonly response: unknown;
  readonly responseText: string;
  readonly responseXML: Document | null;
  readonly finalUrl: string;
  readonly context: unknown;
}

/** 异步版返回体:可 await,同时暴露 abort()。 */
interface GMXMLHttpRequestPromise extends Promise<GMXMLHttpResponse> {
  abort(): void;
}

/** 回调式旧 API 的入参:在异步 details 之上再加一组回调(同步签名与异步不同,故单列)。 */
interface GMXHROptions extends GMXMLHttpRequestDetails {
  synchronous?: boolean;
  onabort?: (response: GMXMLHttpResponse) => void;
  onerror?: (response: GMXMLHttpResponse) => void;
  onload?: (response: GMXMLHttpResponse) => void;
  onloadstart?: (response: GMXMLHttpResponse) => void;
  onloadend?: (response: GMXMLHttpResponse) => void;
  onprogress?: (response: GMXHRProgress) => void;
  onreadystatechange?: (response: GMXMLHttpResponse) => void;
  ontimeout?: (response: GMXMLHttpResponse) => void;
}

interface GMXHRProgress extends GMXMLHttpResponse {
  readonly lengthComputable: boolean;
  readonly loaded: number;
  readonly total: number;
}

/** 回调式旧 API 的返回值:带 abort() 的句柄。 */
interface GMXHRHandle {
  abort(): void;
}

/** 旧版:回调式、同步发起。 */
declare function GM_xmlhttpRequest(details: GMXHROptions): GMXHRHandle;

interface GM {
  /** 新版:Promise 化、异步。 */
  xmlHttpRequest(details: GMXMLHttpRequestDetails): GMXMLHttpRequestPromise;
}

declare const GM: GM;

/** 宿主页真实 window;`@grant unsafeWindow` 后可用。覆写页面 fetch 必须经它,沙箱里的 window 不是页面那个。 */
declare const unsafeWindow: Window & typeof globalThis;
