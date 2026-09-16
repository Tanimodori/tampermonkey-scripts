import { getConfig } from '@/config.ts';
import { upstreamStore } from '@/stores/upstream.ts';
import { getClient } from '../client.ts';
import { asArray, asRecord, parseBody } from '../interceptors/classify.ts';
import { throttle } from '../throttle.ts';

/**
 * The file side of the smartsheet API: what a document holds.
 *
 * One function, because a document coordinate is all this layer knows: `getSheetList` asks which
 * sub-sheets a file has, which is what `stores/upstream.ts` checks the configured `sheetID` against
 * at startup. The records inside a sub-sheet are `record.ts`'s business and the credential is
 * `token.ts`'s; the transport is `client.ts`'s and the pacing is `throttle.ts`'s.
 *
 * See https://docs.qq.com/open/document/app/openapi/v2/smartsheet/sheet/get_sheet.html
 */

/** The document's sub-sheets, as `查询子表` reports them; the store checks its `sheetId` against them. */
export async function getSheetList(fileId: string): Promise<readonly Record<string, unknown>[]> {
  const parsed = new URL(`${getConfig().docs.apiBase}/openapi/smartbook/v2/files/${encodePathSegment(fileId)}/sheets`);
  const headers = await upstreamStore.headers();
  const response = await throttle(() =>
    getClient().request({
      origin: parsed.origin,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers,
      operation: 'getSheet',
      envelope: true,
    }),
  );

  const body = parseBody(await response.body.text());
  const data = asRecord(asRecord(body).data);
  return asArray(data.getSheet ?? data).map((entry) => asRecord(entry));
}

/**
 * A file ID is `[0-9A-Za-z$_-]` in the documented examples and must keep its literal `$`
 * (`300000000$ExAmPlEfIlEiD`), so only genuinely unsafe characters are escaped.
 */
function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%24/g, '$').replace(/%3A/gi, ':');
}
