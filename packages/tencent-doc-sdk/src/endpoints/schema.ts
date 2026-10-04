import { z } from 'zod';

/**
 * 上下游的线上契约，以及调用方递给各端点的入参，全部集中在这里定义。
 *
 * 响应类型沿用上游自己的名字（`CommonRecords`、`Sheet`……），读者可以拿着代码对照文档。这些形状是**对着真实文档量出来的**
 * （2026-09-19），不是照着文档猜的，三处文档没写死的地方以实测为准：`data` 按载荷关键字分段、`userinfo` 的身份直接落在
 * `data` 下、删除只有信封头没有 `data`。响应对象一律宽松，文档里没人读的列（`creatorName`、`autoRawRecords`）原样保留。
 *
 * 入参 schema 相反，是严格的：它们守在上游配额之前，拒掉本库叫不出名字的东西。
 */

// ---------------------------------------------------------------------------
// 每个信封答复都带的头
// ---------------------------------------------------------------------------

/**
 * 信封头，任何判定之前先读它。
 *
 * 本文件里唯一做剥除的 schema：它只取两个字段走判定，答复其余部分由各端点自己的响应 schema 读。
 */
export const answerHeaderSchema = z.object({ ret: z.number().optional(), msg: z.string().optional() });

// ---------------------------------------------------------------------------
// 行与页
// ---------------------------------------------------------------------------

/**
 * 一行的单元格：文档自己的列标题到单元格内容。
 *
 * 刻意宽容，这是上游自己的松弛：文本列可能给带类型的单元格、裸字符串或链接单元格。读不出 `values` 的行仍要算一行（没有单元格）。
 */
export const cellValuesSchema = z.record(z.string(), z.unknown()).catch({});

/**
 * `CommonRecord`：一次读取报告的一行。
 *
 * `recordID` 必填：无法寻址的行既不能更新也不能删除，一页里出现这样的行，读它的人就收不了尾，不如报成一次失败的读取。
 */
export const commonRecordSchema = z.looseObject({
  recordID: z.string(),
  createTime: z.unknown().optional(),
  updateTime: z.unknown().optional(),
  values: z.unknown().optional(),
});

/** `CommonRecords`：一次读取答复的一页——行，以及怎么继续。三个续读字段都可选，翻页因此是调用方的循环。 */
export const commonRecordsSchema = z.looseObject({
  records: z.array(commonRecordSchema).optional(),
  hasMore: z.boolean().optional(),
  next: z.number().optional(),
  total: z.number().optional(),
});

/** 写入答复里的一行：id 与被收下的单元格，没有时间戳（写入不报告它）。 */
export const writtenRecordSchema = z.looseObject({ recordID: z.string().optional(), values: z.unknown().optional() });

/** 写入答复的 `CommonRecords`：被触碰的行，写到哪算哪。 */
export const writtenRecordsSchema = z.looseObject({ records: z.array(writtenRecordSchema).optional() });

// ---------------------------------------------------------------------------
// 子表与凭据
// ---------------------------------------------------------------------------

/**
 * `Sheet`：查询子表报告的一张子表。
 *
 * `isVisible` 是真实文档发的拼写，文档自己的示例写成 `isVibile`；两个都声明，因为本库只按 `sheetID` 寻址，不读这两个字段。
 */
export const sheetSchema = z.looseObject({
  sheetID: z.string(),
  title: z.string().optional(),
  isVisible: z.boolean().optional(),
  isVibile: z.boolean().optional(),
});

/** 子表列表：`data.getSheet` 那一段。 */
export const sheetListSchema = z.array(sheetSchema);

/** `UserInfo`：访问令牌属于谁。只声明读到的 `openID`，其余字段留在宽松侧。 */
export const userInfoSchema = z.looseObject({ openID: z.string().optional(), nick: z.string().optional() });

/**
 * 任一 token 端点答复的东西：新访问令牌，以及它想说的别的。
 *
 * 无信封——这是本库用上游自己词汇读的答复。字段全部可选：`expires_in` 文档承诺了但不保证（调用方回落到令牌自己的 `exp`），
 * `refresh_token` 只在轮换它的流程里出现。
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
// 端点入参：调用方形状，关键字包装与位置分配由适配器完成
// ---------------------------------------------------------------------------

/** 查询记录一页最多取多少行。 */
export const MAX_PAGE_SIZE = 100;

/** 文档 id，按上游的拼法：`[0-9A-Za-z$_-]`，非空。 */
const fileIdSchema = z.string().min(1);

/** 查询子表寻址用坐标。 */
export const fileIdParamsSchema = z.object({ fileId: fileIdSchema });

/** 记录调用寻址用坐标。 */
export const sheetParamsSchema = z.object({ fileId: fileIdSchema, sheetId: z.string().min(1) });

/** 调用自带的坐标覆盖：可以只报一半，另一半由 client 的坐标补上，合并后按完整坐标校验。 */
const sheetOverrideSchema = sheetParamsSchema.partial();
const fileIdOverrideSchema = fileIdParamsSchema.partial();

/** 一行写入时的单元格：列标题到单元格内容。 */
const cellValuesInputSchema = z.record(z.string(), z.unknown());

/** 新增记录里的一行：要收下的单元格。 */
export const recordValuesSchema = z.object({ values: cellValuesInputSchema });

/** 更新记录里的一行：换掉哪一行，换成什么。 */
export const recordUpdateSchema = z.object({ recordID: z.string().min(1), values: cellValuesInputSchema });

/** 查询记录：从第几行（零起）取多少行。 */
export const getRecordsInputSchema = z.object({
  offset: z.number().int().min(0),
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE),
  params: sheetOverrideSchema.optional(),
});

/** 新增记录：要追加的行，按想写入的顺序。 */
export const addRecordsInputSchema = z.object({
  records: z.array(recordValuesSchema).min(1),
  params: sheetOverrideSchema.optional(),
});

/** 更新记录：换哪些行，怎么换。 */
export const updateRecordsInputSchema = z.object({
  records: z.array(recordUpdateSchema).min(1),
  params: sheetOverrideSchema.optional(),
});

/** 删除记录：删哪些行；空列表一律是调用方自己的失误，拒掉。 */
export const deleteRecordsInputSchema = z.object({
  recordIDs: z.array(z.string().min(1)).min(1),
  params: sheetOverrideSchema.optional(),
});

/** 查询子表：可带一份只含 `fileId` 的覆盖。 */
export const sheetListInputSchema = z.object({ params: fileIdOverrideSchema.optional() });

/** 获取 Token：刚发给用户的 code，在它被签发的地址上兑换。 */
export const accessTokenInputSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  code: z.string().min(1),
  redirectUri: z.string().min(1),
});

/** 刷新 Token：手上这枚刷新令牌，答复可能把它换掉。 */
export const refreshTokenInputSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  refreshToken: z.string().min(1),
});

// ---------------------------------------------------------------------------
// 访问令牌本身是个 JWT，只读其中的声明，从不验签
// ---------------------------------------------------------------------------

/** 访问令牌的头段，只读不验（原因在 `token/jwt.ts`）。宽松，意外的头参数留在视野里。 */
export const jwtHeaderSchema = z.looseObject({ alg: z.string().optional(), typ: z.string().optional() });

/** 访问令牌的载荷段：本库读的身份与时限（`clt`、`exp`、`iat`、`sub`），每个键都可选。 */
export const jwtPayloadSchema = z.looseObject({
  clt: z.string().optional(),
  typ: z.unknown().optional(),
  exp: z.number().optional(),
  iat: z.number().optional(),
  sub: z.string().optional(),
});

// ---------------------------------------------------------------------------
// 上面各 schema 描述的类型，按上游的名字，或按端点的名字
// ---------------------------------------------------------------------------

export type AnswerHeader = z.infer<typeof answerHeaderSchema>;
export type CellValues = z.infer<typeof cellValuesSchema>;
export type CommonRecord = z.infer<typeof commonRecordSchema>;
export type CommonRecords = z.infer<typeof commonRecordsSchema>;
export type WrittenRecord = z.infer<typeof writtenRecordSchema>;
export type WrittenRecords = z.infer<typeof writtenRecordsSchema>;
export type Sheet = z.infer<typeof sheetSchema>;
export type UserInfo = z.infer<typeof userInfoSchema>;
export type TokenResponse = z.infer<typeof tokenResponseSchema>;
export type JwtHeader = z.infer<typeof jwtHeaderSchema>;
export type JwtPayload = z.infer<typeof jwtPayloadSchema>;

export type GetRecordsInput = z.infer<typeof getRecordsInputSchema>;
export type AddRecordsInput = z.infer<typeof addRecordsInputSchema>;
export type UpdateRecordsInput = z.infer<typeof updateRecordsInputSchema>;
export type DeleteRecordsInput = z.infer<typeof deleteRecordsInputSchema>;
export type SheetListInput = z.infer<typeof sheetListInputSchema>;
export type AccessTokenInput = z.infer<typeof accessTokenInputSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenInputSchema>;

export type RecordValues = z.infer<typeof recordValuesSchema>;
export type RecordUpdate = z.infer<typeof recordUpdateSchema>;
