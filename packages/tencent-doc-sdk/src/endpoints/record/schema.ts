import { z } from 'zod';

/**
 * 记录端点（查询、新增、更新、删除）的线上契约与入参：四个调用共用一份行与页的词汇。
 *
 * 响应类型沿用上游自己的名字（`CommonRecords`、`CommonRecord`……），读者可以拿着代码对照文档。这些形状是**对着真实文档
 * 量出来的**（2026-09-19），不是照着文档猜的：`data` 按载荷关键字分段。响应对象一律宽松，文档里没人读的列（`creatorName`、
 * `autoRawRecords`）原样保留。
 *
 * 入参 schema 相反，是严格的：它们守在上游配额之前，拒掉本库叫不出名字的东西。
 */

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
// 端点入参：调用方形状，关键字包装与位置分配由适配器完成
// ---------------------------------------------------------------------------

/** 查询记录一页最多取多少行。 */
export const MAX_PAGE_SIZE = 100;

/** 文档 id，按上游的拼法：`[0-9A-Za-z$_-]`，非空。 */
const fileIdSchema = z.string().min(1);

/** 记录调用寻址用坐标。 */
export const sheetParamsSchema = z.object({ fileId: fileIdSchema, sheetId: z.string().min(1) });

/** 调用自带的坐标覆盖：可以只报一半，另一半由 client 的坐标补上，合并后按完整坐标校验。 */
const sheetOverrideSchema = sheetParamsSchema.partial();

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

// ---------------------------------------------------------------------------
// 上面各 schema 描述的类型，按上游的名字，或按端点的名字
// ---------------------------------------------------------------------------

export type CellValues = z.infer<typeof cellValuesSchema>;
export type CommonRecord = z.infer<typeof commonRecordSchema>;
export type CommonRecords = z.infer<typeof commonRecordsSchema>;
export type WrittenRecord = z.infer<typeof writtenRecordSchema>;
export type WrittenRecords = z.infer<typeof writtenRecordsSchema>;

export type GetRecordsInput = z.infer<typeof getRecordsInputSchema>;
export type AddRecordsInput = z.infer<typeof addRecordsInputSchema>;
export type UpdateRecordsInput = z.infer<typeof updateRecordsInputSchema>;
export type DeleteRecordsInput = z.infer<typeof deleteRecordsInputSchema>;

export type RecordValues = z.infer<typeof recordValuesSchema>;
export type RecordUpdate = z.infer<typeof recordUpdateSchema>;
