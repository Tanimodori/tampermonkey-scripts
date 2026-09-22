import type { ClientContext } from '@/client/context';
import { request } from '@/client/request';
import { cannotAssemble } from '@/validation/classify';
import { getSheetResponseSchema } from '@/validation/schemas';
import type { Sheet } from '@/validation/types';
import type { EndpointTarget } from './address';
import { sheetsUrl } from './address';

/**
 * 查询子表: which sub-sheets a document holds.
 *
 * See https://docs.qq.com/open/document/app/openapi/v2/smartsheet/sheet/get_sheet.html
 */

/** The document's sub-sheets, as 查询子表 reports them; a caller checks its configured `sheetID` against them. */
export async function getSheetList(target: EndpointTarget, headers: Record<string, string>, context: ClientContext): Promise<readonly Sheet[]> {
  const operation = 'getSheet';
  let url: URL;
  try {
    url = sheetsUrl(target);
  } catch (error) {
    throw cannotAssemble(operation, error);
  }

  const answer = await request(url, { method: 'GET', headers }, { ...context, operation, envelope: true, responseSchema: getSheetResponseSchema });
  return answer.data.getSheet;
}
