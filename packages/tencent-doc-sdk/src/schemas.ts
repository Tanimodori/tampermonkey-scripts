import { z } from 'zod';

/**
 * The wire contract of the Tencent Docs Open API, named exactly as the upstream names it.
 *
 * Every response type here carries the official name (`GetRecordsResponse`, `CommonRecords`, `Sheet`,
 * …) so a reader can put the code next to the documentation without translating. The names are not
 * invented: they come from the endpoint pages, and the shapes behind them were **measured against a
 * live document** (2026-09-19) rather than assumed — the measurements settled three questions the
 * documentation leaves open:
 *
 * - `data` is keyed by the payload keyword (`data.getRecords`, `data.addRecords`, `data.getSheet`),
 *   so every smartsheet response declares its own section and no reader has to guess;
 * - `userinfo` is the exception: its `data` holds the identity **directly**, with no `userinfo` key;
 * - `deleteRecords` answers with the header alone, so its response type has no `data` at all.
 *
 * Objects are loose, because a row carries columns nobody reads (`creatorName`, `autoRawRecords`, and
 * whatever the document's owner adds) and stripping them would hide from an operator the very answer
 * being complained about. Looseness is about *extra* keys; every key this library reads is declared
 * and typed.
 */

// ---------------------------------------------------------------------------
// The header every smartsheet answer carries
// ---------------------------------------------------------------------------

/**
 * The envelope's header, read from every answer before anything judges it.
 *
 * The only schema here that strips: it exists to take two fields out of an answer, and everything else
 * about that answer is read through the response type of whoever asked for it.
 */
export const answerHeaderSchema = z.object({ ret: z.number().optional(), msg: z.string().optional() });

/** The header half of every smartsheet response type: `ret` is present, or it is not an envelope. */
const envelopeHead = { ret: z.number(), msg: z.string().optional() } as const;

// ---------------------------------------------------------------------------
// Rows and pages
// ---------------------------------------------------------------------------

/**
 * A row's cell values: the document's own column titles to whatever the cells hold.
 *
 * Deliberately tolerant, and it is the upstream's own looseness rather than this library's: a text
 * column comes back as a typed cell, a bare string or a link cell, and the two instant columns as
 * either encoding. A caller that reads cells of its own normalizes them itself, so an unreadable
 * `values` must still read as a row — with no cells.
 */
export const cellValuesSchema = z.record(z.string(), z.unknown()).catch({});

/**
 * `CommonRecord`: one row of a sub-sheet, as a read reports it.
 *
 * `recordID` is required: a row that cannot be addressed can be neither updated nor deleted, and a
 * page that carried one would be a page its reader cannot finish, so it is better named as a failed
 * read. The two instants stay `unknown` because the sheet sends them as strings and both encodings of
 * a cell occur in the wild; a row also carries `creatorName` and friends, which are kept and unread.
 */
export const CommonRecordSchema = z.looseObject({
  recordID: z.string(),
  createTime: z.unknown().optional(),
  updateTime: z.unknown().optional(),
  values: z.unknown().optional(),
});

/**
 * `CommonRecords`: the page a read answers with — the rows, and how to continue.
 *
 * Measured live: `next` is the offset to ask for next, `hasMore` says whether to ask again, and
 * `total` counts the sheet. All three are optional because the document decides when to say them, so
 * paging is the caller's loop and it may have to fall back to counting the rows it just read.
 */
export const CommonRecordsSchema = z.looseObject({
  records: z.array(CommonRecordSchema).optional(),
  hasMore: z.boolean().optional(),
  next: z.number().optional(),
  total: z.number().optional(),
});

/**
 * A row as a **write** answers it: the id, and the cells that were taken.
 *
 * The live document does return `recordID` here (measured), and `AddRecordsResponse` documents it, but
 * neither carries the row's instants — a write is answered without them, so a caller that needs them
 * reads them back. The id is optional because a caller has to cope with a document that answers
 * without one; what that means for its own state is the caller's decision.
 */
export const WrittenRecordSchema = z.looseObject({ recordID: z.string().optional(), values: z.unknown().optional() });

/** The `CommonRecords` a write answers with: the rows it touched, as far as it says. */
export const WrittenRecordsSchema = z.looseObject({ records: z.array(WrittenRecordSchema).optional() });

// ---------------------------------------------------------------------------
// One response type per endpoint, under the upstream's own name
// ---------------------------------------------------------------------------

/** `GetRecordsResponse`: 查询记录. */
export const GetRecordsResponseSchema = z.looseObject({ ...envelopeHead, data: z.looseObject({ getRecords: CommonRecordsSchema }) });

/** `AddRecordsResponse`: 新增记录. */
export const AddRecordsResponseSchema = z.looseObject({ ...envelopeHead, data: z.looseObject({ addRecords: WrittenRecordsSchema }) });

/** `UpdateRecordsResponse`: 更新记录. */
export const UpdateRecordsResponseSchema = z.looseObject({ ...envelopeHead, data: z.looseObject({ updateRecords: WrittenRecordsSchema }) });

/** `DeleteRecordsResponse`: 删除记录 — measured: the header alone, no `data` at all. */
export const DeleteRecordsResponseSchema = z.looseObject(envelopeHead);

/**
 * `Sheet`: one sub-sheet as 查询子表 reports it.
 *
 * `isVisible` is what the live document sends; the documentation's own example spells it `isVibile`.
 * Both are declared, because this library addresses sub-sheets by `sheetID` and reads neither, and a
 * reader comparing an answer against the docs should not have to explain the difference away.
 */
export const SheetSchema = z.looseObject({
  sheetID: z.string(),
  title: z.string().optional(),
  isVisible: z.boolean().optional(),
  isVibile: z.boolean().optional(),
});

/** `GetSheetResponse`: 查询子表. */
export const GetSheetResponseSchema = z.looseObject({ ...envelopeHead, data: z.looseObject({ getSheet: z.array(SheetSchema) }) });

/**
 * `UserInfo`: who the access token belongs to.
 *
 * Only `openID` is declared, because only it is read; the answer also carries `nick`, `avatar`,
 * `source`, `fileAuthType` and `unionID` (measured), which stay on the loose side of the schema.
 */
export const UserInfoSchema = z.looseObject({ openID: z.string().optional(), nick: z.string().optional() });

/** `UserInfoResponse`: 获取用户信息 — measured: its `data` holds the identity directly, with no key. */
export const UserInfoResponseSchema = z.looseObject({ ...envelopeHead, data: UserInfoSchema });

/**
 * The token endpoint's answer: a new access token, and nothing else it has to say.
 *
 * No envelope — this is the one answer this library reads by the upstream's own vocabulary, which is
 * why it is a bare body and why a `400` here is an answer whose failure its caller words. Every field
 * is optional: `expires_in` is documented but not promised (a caller then falls back to the token's
 * own `exp` claim), and `refresh_token` appears only on the flows that rotate it.
 */
export const RefreshTokenResponseSchema = z.looseObject({
  access_token: z.string().optional(),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  user_id: z.string().optional(),
});

/** The claims readable out of an access token, when the answer carried no lifetime. */
export const accessTokenClaimsSchema = z.looseObject({ exp: z.number().optional(), sub: z.string().optional() });
