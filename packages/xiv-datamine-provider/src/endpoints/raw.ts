import { ApiError, ApiErrorCodes, isApiError, verifyResponseCode } from 'api-sdk-framework';
import { inputOf } from '@/client/client';
import type { DatamineClient } from '@/client/client';
import { DEFAULT_LOCALE, DEFAULT_REF } from '@/client/constants';
import type { ApiResponse, DatamineEndpoint } from '@/types/sdk';
import { sheetCsvUrl } from './index';

/**
 * 这个 provider 读的唯一一个端点：一张表文件，按它就是的文本收下。
 *
 * 没有 schema 描述 CSV 网格——它的形状检查是 `parseSheetCsv` 的表头校验，发生在进入调用方网格的路上——因此
 * 没有 verified 的另一半，端点保持本名。
 *
 * 答复是 CSV 文本而不是 JSON，所以端点用框架的 `responseBodyReader` 换掉缺省的 `raw.json()`；状态与头字段仍由
 * 框架从原生响应取。判定与措辞留在 `responseAdaptor` 里：那是唯一同时看得到状态和这一次入参的地方——错误族仍
 * 由框架的 `verifyResponseCode` 归（404 是它的 `ENDPOINT_NOT_FOUND`），但通用消息 `HTTP <status>` 换成本包那句带坐标的。
 */

export interface FetchSheetCsvInput {
  readonly sheet: string;
  /** 分支、tag 或 commit。默认 `HEAD`；要复现同一次构建就写死一个。 */
  readonly ref?: string;
  readonly locale?: string;
}

/** 这一次调用的坐标，写失败消息用；入参里缺的那两项落在默认值上。 */
const coordinatesOf = (client: DatamineClient): FetchSheetCsvInput => (inputOf(client) ?? {}) as FetchSheetCsvInput;

/**
 * 收下一份答复：非 2xx 由框架归族、措辞换成本包那句，空体按形状失败，其余交出文本。
 *
 * 归族交给框架的 `verifyResponseCode`（404 归 `ENDPOINT_NOT_FOUND`，401/403 归 `UNAUTHORIZED`，429 归 `RATE_LIMIT`，
 * 5xx 归 `SERVER_ERROR`，其余归 `BAD_REQUEST`），本包只把它的消息换掉——一次构建读很多张表，诊断里点得出"哪张
 * 表、哪个语种、哪个 ref"才有用。错误码沿用框架给的那个，族因此不随这里的用词漂移。归类里抛出的错误由框架的
 * `call` 补上 `operation` 与 `request`，所以这里只写下状态与消息。
 */
const readSheetCsv = (client: DatamineClient, response: ApiResponse): string => {
  const { sheet, ref, locale } = coordinatesOf(client);

  try {
    verifyResponseCode(response);
  } catch (cause) {
    // `verifyResponseCode` 只抛 `ApiError`；万一不是，原样抛出，不替它编一个码。
    if (!isApiError(cause)) throw cause;
    const message =
      response.status === 404 ? `${sheet}: no ${locale ?? DEFAULT_LOCALE} sheet at ${ref ?? DEFAULT_REF}` : `${sheet}.csv failed: HTTP ${response.status}`;
    throw new ApiError({ errorCode: cause.errorCode, message, response });
  }

  const text = response.body as string;
  // 以 200 发来的空体不是一张空表，是一份没有读成 CSV 的答复；在这里拒掉，构建才不会把它缓存下来，再到读列名
  // 的那一步才炸。
  if (text.trim() === '') throw new ApiError({ errorCode: ApiErrorCodes.BAD_OUTPUT, message: 'empty body', response });
  return text;
};

export const fetchSheetCsv: DatamineEndpoint<FetchSheetCsvInput, string> = {
  operation: 'fetchSheetCsv',
  responseBodyReader: (_client, response) => response.text(),
  requestAdaptor: (_client, { sheet, ref, locale }) => ({
    url: sheetCsvUrl(sheet, { ref, locale }).href,
    init: { headers: { accept: 'text/csv,text/plain,*/*' } },
  }),
  responseAdaptor: (client, response) => readSheetCsv(client, response),
};
