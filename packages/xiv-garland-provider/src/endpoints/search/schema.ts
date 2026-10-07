import { z } from 'zod';

/**
 * 检索组的 zod 定义，也是本包唯一值导入 `zod` 的地方之一。
 *
 * 两份值导入各在自己那一组的 `schema.ts` 里。两组共用的片断住在 `@/endpoints/doc/schema.ts`，检索组今天一个都
 * 用不到——命中的 `obj` 是各文档种类把同一批字段压进几个字母，除了文档种类共有的编号与名称，形状由镜像给，不由
 * 本包拼。
 */

/**
 * 一条命中携带的紧凑记录。
 *
 * 它天生是异构的：出现哪些键取决于文档种类，有时还取决于单条记录，同一个字母在不同种类里含义也不同（`c` 在有些
 * 种类是图标、在另一些是数组）。所以只有 `i` 与 `n`，也就是每个种类都给的编号与名称，列为必填，其余一律留
 * `unknown` 而不去猜。要读 `obj.g` 的调用方自己取值、自己判型。
 */
export const garlandSearchObjSchema = z.looseObject({
  i: z.number(),
  n: z.string(),
  c: z.unknown().optional(),
  j: z.unknown().optional(),
  t: z.unknown().optional(),
  l: z.unknown().optional(),
  r: z.unknown().optional(),
  g: z.unknown().optional(),
  p: z.unknown().optional(),
  f: z.unknown().optional(),
});
export type GarlandSearchObj = z.infer<typeof garlandSearchObjSchema>;

/**
 * 一条 `search.php` 命中。
 *
 * `id` 是 JSON **字符串**，不是数字。两个 userscript 包都把它声明成 `number`，`universalis-zh-data/src/index.ts`
 * 还直接把它赋进 `ID: number`，所以页面渲染的那个值一直是字符串。同一个编号在 `obj.i` 里是真的数字，取它用
 * `garlandHitId`。
 */
export const garlandSearchItemSchema = z.looseObject({ type: z.string(), id: z.string(), obj: garlandSearchObjSchema });
export type GarlandSearchItem = z.infer<typeof garlandSearchItemSchema>;

export const garlandSearchResponseSchema = z.array(garlandSearchItemSchema);
