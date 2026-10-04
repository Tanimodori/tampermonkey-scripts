import type { DatamineEndpoint } from './client.ts';
import { sheetCsvUrl } from './sheet.ts';

/**
 * 这个 provider 读的唯一一个端点：一张表文件，按它就是的文本收下。
 *
 * 没有 schema 描述 CSV 网格——它的形状检查是 `parseSheetCsv` 的表头校验，发生在进入调用方网格的路上——因此
 * 没有 verified 的另一半，端点保持本名。
 */

export interface FetchSheetCsvInput {
  readonly sheet: string;
  /** 分支、tag 或 commit。默认 `HEAD`；要复现同一次构建就写死一个。 */
  readonly ref?: string;
  readonly locale?: string;
}

export const fetchSheetCsv: DatamineEndpoint<FetchSheetCsvInput, string> = {
  operation: 'fetchSheetCsv',
  read: 'text',
  requestAdaptor: (_client, { sheet, ref, locale }) => ({
    url: sheetCsvUrl(sheet, { ref, locale }).href,
    init: { headers: { accept: 'text/csv,text/plain,*/*' } },
  }),
  responseAdaptor: (_client, response) => response.body as string,
};
