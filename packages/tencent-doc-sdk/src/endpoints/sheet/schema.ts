import { z } from 'zod';

/**
 * 子表端点（查询子表）的线上契约与入参。
 *
 * `Sheet` 沿用上游自己的名字，读者可以拿着代码对照文档；形状是**对着真实文档量出来的**（2026-09-19）。响应对象一律宽松，
 * 文档里没人读的列原样保留；入参 schema 相反，是严格的。
 */

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

/** 文档 id，按上游的拼法：`[0-9A-Za-z$_-]`，非空。 */
const fileIdSchema = z.string().min(1);

/** 查询子表寻址用坐标。 */
export const fileIdParamsSchema = z.object({ fileId: fileIdSchema });

/** 调用自带的坐标覆盖：可以只报一半，另一半由 client 的坐标补上，合并后按完整坐标校验。 */
const fileIdOverrideSchema = fileIdParamsSchema.partial();

/** 查询子表：可带一份只含 `fileId` 的覆盖。 */
export const sheetListInputSchema = z.object({ params: fileIdOverrideSchema.optional() });

// ---------------------------------------------------------------------------
// 上面各 schema 描述的类型，按上游的名字，或按端点的名字
// ---------------------------------------------------------------------------

export type Sheet = z.infer<typeof sheetSchema>;
export type SheetListInput = z.infer<typeof sheetListInputSchema>;
