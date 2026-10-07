/**
 * 这个包只抛一种失败，以及把抛出处不知道的信息补上的包装。
 *
 * 一次调用只抛 `ProviderError`。抛出处写下它理解的——kind、消息、收到的状态码——地址与 `operation` 由调用链补
 * 上，于是从响应适配器里抛出的失败也点得名是哪次读取。已经是 `ProviderError` 的原样保留：包装只填空着的字段，
 * 不改判。
 */

export type Provider = 'xivapi' | 'garlands';

/** 一次读取可能失败在哪一层：装配归 `input`，发出归 `network`/`timeout`，答复归 `http`/`shape`，发请求前就判掉的拒绝归 `unsupported`。 */
export type ProviderErrorKind = 'http' | 'network' | 'timeout' | 'shape' | 'unsupported' | 'input';

/** 抛出处能供给的全部字段；`url` 与 `operation` 通常由调用链补上。 */
export interface ProviderErrorInit {
  readonly kind: ProviderErrorKind;
  readonly provider: Provider;
  readonly message: string;
  readonly url?: string | null;
  readonly operation?: string | null;
  readonly status?: number | null;
  readonly apiCode?: number | null;
  readonly cause?: unknown;
}

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly provider: Provider;
  /** 请求地址；抛出处不知道时由调用链补上。 */
  url: string | null;
  /** endpoint 的 `operation`；由调用链补上。 */
  operation: string | null;
  /** 收到过的 HTTP 状态码。 */
  readonly status: number | null;
  /** 服务端发来的 JSON 错误体里的 `code`。 */
  readonly apiCode: number | null;
  /**
   * 声明而不是传给 `super`：两参数的 `Error` 构造函数是 ES2022，而本包以 ES2020 为目标，
   * 让产物在 userscript 能跑的地方都跑得起来。
   */
  readonly cause?: unknown;

  constructor(init: ProviderErrorInit) {
    super(init.message);
    this.name = 'ProviderError';
    this.kind = init.kind;
    this.provider = init.provider;
    this.url = init.url ?? null;
    this.operation = init.operation ?? null;
    this.status = init.status ?? null;
    this.apiCode = init.apiCode ?? null;
    this.cause = init.cause;
  }
}

export const isProviderError = (error: unknown): error is ProviderError => error instanceof ProviderError;

/**
 * 还不是 `ProviderError` 的按这份 init 新建，原错误留在 `cause`；已经是 `ProviderError` 的只补它空着的字段
 * （`??=`），保留抛出处下的判断。
 */
export const wrapProviderError = (
  cause: unknown,
  init: {
    readonly kind: ProviderErrorKind;
    readonly provider: Provider;
    readonly url?: string | null;
    readonly operation?: string | null;
    readonly message?: string;
    readonly status?: number | null;
    readonly apiCode?: number | null;
  },
): ProviderError => {
  if (isProviderError(cause)) {
    cause.url ??= init.url ?? null;
    cause.operation ??= init.operation ?? null;
    return cause;
  }
  return new ProviderError({
    ...init,
    message: init.message ?? (cause instanceof Error ? cause.message : String(cause)),
    cause,
  });
};
