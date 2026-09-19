import { getConfig } from '@/config.ts';
import { upstreamStore } from '@/stores/upstream.ts';
import type { Sheet } from '@/validation/upstream.ts';
import { GetSheetResponseSchema } from '@/validation/upstream.ts';
import { sendEnvelope } from '../send.ts';
import { encodePathSegment } from '../url.ts';

/**
 * The file side of the smartsheet API: what a document holds.
 *
 * One function, because a document coordinate is all this layer knows: `getSheetList` asks which
 * sub-sheets a file has, which is what `stores/upstream.ts` checks the configured `sheetID` against
 * at startup. The records inside a sub-sheet are `record.ts`'s business and the credential is
 * `token.ts`'s; the call itself — pacing, attempts, classification — is `send.ts`'s.
 *
 * See https://docs.qq.com/open/document/app/openapi/v2/smartsheet/sheet/get_sheet.html
 */

/** The document's sub-sheets, as `查询子表` reports them; the store checks its `sheetId` against them. */
export async function getSheetList(fileId: string): Promise<readonly Sheet[]> {
  const parsed = new URL(`${getConfig().docs.apiBase}/openapi/smartbook/v2/files/${encodePathSegment(fileId)}/sheets`);
  const answer = await sendEnvelope(
    {
      origin: parsed.origin,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'GET',
      headers: await upstreamStore.headers(),
      operation: 'getSheet',
    },
    GetSheetResponseSchema,
  );

  return answer.data.getSheet;
}
