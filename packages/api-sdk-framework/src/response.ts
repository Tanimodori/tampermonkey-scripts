import { ApiError, ApiErrorCodes, wrapApiError } from '@/error';
import type { ApiResponse, BodyUnpacker, BodyUnpackerOptions } from '@/types';

/**
 * response 切面：答复的通用读取。`verifyResponseCode` 只看 HTTP 状态码，把非 2xx 全部归入错误码；`useBodyUnpacker`
 * 读信封里的 code、msg 与 data；更细的答复契约由下游自行实现 `BodyUnpacker`。
 */

/** 失败消息：正文是对象且 `msg`/`message` 是非空字符串时用它，否则按状态码措辞。 */
const failureMessageOf = (body: unknown, status: number): string => {
  if (typeof body === 'object' && body !== null) {
    const { msg, message } = body as { msg?: unknown; message?: unknown };
    if (typeof msg === 'string' && msg !== '') return msg;
    if (typeof message === 'string' && message !== '') return message;
  }
  return `HTTP ${status}`;
};

/**
 * HTTP 状态码的通用校验：2xx 静默通过；401/403 归 `UNAUTHORIZED`，404 归 `ENDPOINT_NOT_FOUND`，429 归 `RATE_LIMIT`，
 * >=500 归 `SERVER_ERROR`，其余非 2xx（400/422 等）归 `BAD_REQUEST`。消息取正文里的 `msg` 或 `message`，取不到
 * 才是 `HTTP ${status}`。
 */
export function verifyResponseCode(response: ApiResponse): void {
  const { status, body } = response;
  if (status >= 200 && status < 300) return;
  const errorCode =
    status === 401 || status === 403
      ? ApiErrorCodes.UNAUTHORIZED
      : status === 404
        ? ApiErrorCodes.ENDPOINT_NOT_FOUND
        : status === 429
          ? ApiErrorCodes.RATE_LIMIT
          : status >= 500
            ? ApiErrorCodes.SERVER_ERROR
            : ApiErrorCodes.BAD_REQUEST;
  throw new ApiError({ errorCode, message: failureMessageOf(body, status), response });
}

/** 一次读取的规则：字符串是 body 的属性名，函数收下 body。 */
type Getter<Value> = string | ((body: unknown) => Value);

const read = (getter: Getter<unknown>, body: unknown): unknown => {
  if (typeof getter === 'function') return getter(body);
  if (typeof body !== 'object' || body === null) return undefined;
  return (body as Record<string, unknown>)[getter];
};

/** 判定失败时的消息：上游说了 msg 就用它。 */
const messageOf = (msg: string | undefined, code: number | string | undefined): string => {
  if (msg !== undefined && msg !== '') return msg;
  return code === undefined ? 'Invalid response body' : `Invalid response code: ${code}`;
};

/**
 * 造一个按信封读取的 `BodyUnpacker`：`codeGetter`/`msgGetter`/`dataGetter` 缺省读 `code`/`msg`/`data`，
 * `isBodyValid` 缺省要求 code 为 0；判定不过抛 `BAD_REQUEST`，读取的普通函数抛出的错误收拢成 `ApiError`（归
 * `BAD_OUTPUT`）。每一项规则都可以覆盖，下游也可以完全自行实现。
 */
export function useBodyUnpacker<T>(options: BodyUnpackerOptions<T> = {}): BodyUnpacker<T> {
  const codeGetter: Getter<number | string> = options.codeGetter ?? 'code';
  const msgGetter: Getter<string> = options.msgGetter ?? 'msg';
  const dataGetter: Getter<T> = options.dataGetter ?? 'data';
  const isBodyValid: (body: unknown, code: number | string | undefined, msg: string | undefined) => boolean =
    options.isBodyValid ?? ((_body: unknown, code: number | string | undefined) => code === 0);

  return (response) => {
    // 读取规则与判定都是调用方给的普通函数，它们抛出的错误在这里收拢，解包器因此也只抛 ApiError。
    try {
      const { body } = response;
      const code = read(codeGetter, body) as number | string | undefined;
      const msg = read(msgGetter, body) as string | undefined;
      if (!isBodyValid(body, code, msg)) {
        throw new ApiError({ errorCode: ApiErrorCodes.BAD_REQUEST, message: messageOf(msg, code), response });
      }
      return read(dataGetter, body) as T;
    } catch (cause) {
      throw wrapApiError(cause, { errorCode: ApiErrorCodes.BAD_OUTPUT, response });
    }
  };
}
