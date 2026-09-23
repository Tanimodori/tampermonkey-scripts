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
export const commonRecordSchema = z.looseObject({
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
export const commonRecordsSchema = z.looseObject({
  records: z.array(commonRecordSchema).optional(),
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
export const writtenRecordSchema = z.looseObject({ recordID: z.string().optional(), values: z.unknown().optional() });

/** The `CommonRecords` a write answers with: the rows it touched, as far as it says. */
export const writtenRecordsSchema = z.looseObject({ records: z.array(writtenRecordSchema).optional() });

// ---------------------------------------------------------------------------
// One response type per endpoint, under the upstream's own name
// ---------------------------------------------------------------------------

/** `GetRecordsResponse`: 查询记录. */
export const getRecordsResponseSchema = z.looseObject({ ...envelopeHead, data: z.looseObject({ getRecords: commonRecordsSchema }) });

/** `AddRecordsResponse`: 新增记录. */
export const addRecordsResponseSchema = z.looseObject({ ...envelopeHead, data: z.looseObject({ addRecords: writtenRecordsSchema }) });

/** `UpdateRecordsResponse`: 更新记录. */
export const updateRecordsResponseSchema = z.looseObject({ ...envelopeHead, data: z.looseObject({ updateRecords: writtenRecordsSchema }) });

/** `DeleteRecordsResponse`: 删除记录 — measured: the header alone, no `data` at all. */
export const deleteRecordsResponseSchema = z.looseObject(envelopeHead);

/**
 * `Sheet`: one sub-sheet as 查询子表 reports it.
 *
 * `isVisible` is what the live document sends; the documentation's own example spells it `isVibile`.
 * Both are declared, because this library addresses sub-sheets by `sheetID` and reads neither, and a
 * reader comparing an answer against the docs should not have to explain the difference away.
 */
export const sheetSchema = z.looseObject({
  sheetID: z.string(),
  title: z.string().optional(),
  isVisible: z.boolean().optional(),
  isVibile: z.boolean().optional(),
});

/** `GetSheetResponse`: 查询子表. */
export const getSheetResponseSchema = z.looseObject({ ...envelopeHead, data: z.looseObject({ getSheet: z.array(sheetSchema) }) });

/**
 * `UserInfo`: who the access token belongs to.
 *
 * Only `openID` is declared, because only it is read; the answer also carries `nick`, `avatar`,
 * `source`, `fileAuthType` and `unionID` (measured), which stay on the loose side of the schema.
 */
export const userInfoSchema = z.looseObject({ openID: z.string().optional(), nick: z.string().optional() });

/** `UserInfoResponse`: 获取用户信息 — measured: its `data` holds the identity directly, with no key. */
export const userInfoResponseSchema = z.looseObject({ ...envelopeHead, data: userInfoSchema });

/**
 * What either token endpoint answers: a new access token, and nothing else it has to say.
 *
 * No envelope — this is the one answer this library reads by the upstream's own vocabulary, which is
 * why it is a bare body and why a `400` here is an answer whose failure its caller words. Every field
 * is optional: `expires_in` is documented but not promised (a caller then falls back to the token's
 * own `exp` claim), and `refresh_token` appears only on the flows that rotate it.
 */
export const tokenResponseSchema = z.looseObject({
  access_token: z.string().optional(),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  user_id: z.string().optional(),
});

// ---------------------------------------------------------------------------
// What a caller hands one endpoint, checked before a request is assembled
// ---------------------------------------------------------------------------

/**
 * The parts of a call that are this library's own risk, described as strictly as the upstream describes
 * them.
 *
 * These are the only schemas here that are not loose, and that is deliberate: every schema above judges an
 * answer the upstream already sent, where an extra key costs nothing and a missing one is the finding. A
 * request schema exists to refuse a call before it spends quota and comes back as `bad_request`, so it
 * rejects what it cannot name — and `z.object` stripping the rest is what keeps `params` down to exactly
 * the placeholders a `path` may interpolate.
 */

/** The most rows 查询记录 answers with in one page. See docs/api/upstream/record.md: `limit` 上限 100. */
export const MAX_PAGE_SIZE = 100;

/** A document id as the upstream spells it: `[0-9A-Za-z$_-]`, and never empty. */
const fileIdSchema = z.string().min(1);

/** The one coordinate 查询子表 addresses by. */
export const fileIdParamsSchema = z.object({ fileId: fileIdSchema });

/** The two coordinates every record call addresses by. */
export const sheetParamsSchema = z.object({ fileId: fileIdSchema, sheetId: z.string().min(1) });

/** One row's cells as a write takes them: column titles to whatever the cells hold. */
const cellValuesInputSchema = z.record(z.string(), z.unknown());

/** 查询记录: which page, from a zero-based row number. */
export const getRecordsParamsSchema = z.object({ offset: z.number().int().min(0), limit: z.number().int().min(1).max(MAX_PAGE_SIZE) });

/** One row as 新增记录 takes it: the cell values keyed by column title. */
export const recordValuesSchema = z.object({ values: cellValuesInputSchema });

/** One row as 更新记录 takes it: which row, and the cells to replace it with. */
export const recordUpdateSchema = z.object({ recordID: z.string().min(1), values: cellValuesInputSchema });

/** 查询记录, as it goes on the wire. */
export const getRecordsBodySchema = z.object({ getRecords: getRecordsParamsSchema });

/** 新增记录: the rows to append, in the order they should be written. */
export const addRecordsBodySchema = z.object({ addRecords: z.object({ records: z.array(recordValuesSchema).min(1) }) });

/** 更新记录: which rows, and the cells to replace each with. */
export const updateRecordsBodySchema = z.object({ updateRecords: z.object({ records: z.array(recordUpdateSchema).min(1) }) });

/** 删除记录: the rows to remove. An empty list is refused because it is always a caller's mistake, never a sweep. */
export const deleteRecordsBodySchema = z.object({ deleteRecords: z.object({ recordIDs: z.array(z.string().min(1)).min(1) }) });

/** The application a grant is made for, named the way the token endpoint names it. */
const grantQueryHead = { client_id: z.string().min(1), client_secret: z.string().min(1) } as const;

/** 获取 Token: the code just issued to a user, exchanged at the address it was issued for. */
export const accessTokenQuerySchema = z.object({
  ...grantQueryHead,
  grant_type: z.literal('authorization_code'),
  code: z.string().min(1),
  redirect_uri: z.string().min(1),
});

/** 刷新 Token: the refresh token held so far, which the answer may replace. */
export const refreshTokenQuerySchema = z.object({
  ...grantQueryHead,
  grant_type: z.literal('refresh_token'),
  refresh_token: z.string().min(1),
});

// ---------------------------------------------------------------------------
// The JWT an access token is, read for its claims and never verified
// ---------------------------------------------------------------------------

/**
 * The header segment of an access token, decoded for reading only (`token/jwt.ts` says why the
 * signature is not verified). Loose so an unexpected header parameter stays visible rather than
 * failing a token whose payload is perfectly readable.
 */
export const jwtHeaderSchema = z.looseObject({ alg: z.string().optional(), typ: z.string().optional() });

/**
 * The payload segment of an access token: the identity and lifetimes this library reads (`clt`, `exp`,
 * `iat`, `sub`), every key optional because a caller reads whichever the token happens to carry.
 *
 * `typ` is declared as `unknown` rather than typed: the payload's `typ` is a number (`1`) where the
 * header's is the string `"JWT"`, and nothing reads it, so constraining it would only risk rejecting
 * a whole token over a field nobody looks at.
 */
export const jwtPayloadSchema = z.looseObject({
  clt: z.string().optional(),
  typ: z.unknown().optional(),
  exp: z.number().optional(),
  iat: z.number().optional(),
  sub: z.string().optional(),
});
