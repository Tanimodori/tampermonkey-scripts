import type { WebFetcher } from 'universal-fetch-type';
import { createDatamineClient } from '@/client/client';
import { DEFAULT_LOCALE, DEFAULT_REF, DATAMINING_REPOSITORY } from '@/client/constants';
import { parseSheetCsv, type SheetRawData } from '@/utils/parse';
import { fetchSheetCsv } from './raw';

/**
 * SaintCoinach 解包数据集的在线访问：一张表一个文件、一语种一份 CSV。
 *
 * 这个 provider 不认识任何一张表。它回答"给我这个文件"，交回的就是那个文件的网格——三行表头在内、每格都是
 * 字符串——列的含义留给调用方，这正是拆分的意义：可用的表是上游的（几千张），不是这个包的。
 *
 * 默认 ref 是分支头，构建因此读到当下的数据，而不必先问任何人"最新 release 是哪个"。GitHub 的 API 完全不
 * 参与：`raw.githubusercontent.com` 直接按 ref 名服务，于是没有限流、也没有 release 打 tag 的滞后。404 在这
 * 里是正常答案，有些语种就是不带某张表。
 *
 * 地址那几项常数在 `@/client/constants.ts`，因为 `@/client/client.ts`（时限）与 `./raw.ts`（失败消息）也要用它们。
 */

export interface DatamineOptions {
  /**
   * 请求发往哪里。默认取平台自己的 `fetch`；userscript 传拦截前的那份，Node 侧可以传一个认 `HTTPS_PROXY`
   * 的实现，那是 `fetch` 自己不做的。
   */
  readonly fetch?: WebFetcher;
  /** 分支、tag 或 commit。默认 `HEAD`；要复现同一次构建就写死一个。 */
  readonly ref?: string;
  readonly locale?: string;
  readonly timeoutMs?: number;
}

export const sheetCsvUrl = (sheet: string, options: { readonly ref?: string; readonly locale?: string } = {}): URL =>
  new URL(
    `https://raw.githubusercontent.com/${DATAMINING_REPOSITORY}/${encodeURIComponent(options.ref ?? DEFAULT_REF)}/${options.locale ?? DEFAULT_LOCALE}/${encodeURIComponent(sheet)}.csv`,
  );

/**
 * 取一张表并解析成它的原始网格，一次调用完成——想要表的调用方伸手够到的那份组合。`@/utils/table.ts` 把它读成
 * 可寻址的表；只想要字节的调用方，改经 client 调 `fetchSheetCsv` 端点。
 */
export const readSheet = async (sheet: string, options: DatamineOptions = {}): Promise<SheetRawData> => {
  const client = createDatamineClient({ fetch: options.fetch, timeoutMs: options.timeoutMs });
  const csv = await client.call(fetchSheetCsv, { sheet, ref: options.ref, locale: options.locale });
  return parseSheetCsv(csv, `${sheet}.csv@${options.ref ?? DEFAULT_REF}`);
};
