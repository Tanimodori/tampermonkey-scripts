import { z } from 'zod';

/**
 * 文档组的 zod 定义，也是本包唯一值导入 `zod` 的地方之一。
 *
 * 业务代码从这里 `import type` 取推断出的类型，所以 `zod` 不进核心产物；schema 本身由 verified 装配在投影之后跑
 * 一次，测试也拿它断言。Garland 的建模刻意比 xivapi 宽松得多，理由见下面各处。检索组另有一份自己的
 * `@/endpoints/search/schema.ts`，两组共用的片断只写在这里那一次。
 */

/** 一份文档里作为子对象出现的语种键。 */
export const garlandSubLocales = ['en', 'ja', 'fr', 'de', 'tc', 'ko'] as const;
export type GarlandSubLocale = (typeof garlandSubLocales)[number];

/**
 * `search.php?lang=` 与 `/db/doc/…/{locale}/…` 段接受的值。
 *
 * `chs` 是镜像给顶层的那个语种起的名字，文档里没有 `chs` 子对象，因为 `name`、`description` 本身就已经是所请求的
 * 语言。
 */
export const garlandRequestLocales = ['chs', 'ja', 'en', 'de', 'fr'] as const;
export type GarlandRequestLocale = (typeof garlandRequestLocales)[number];

export const garlandNameDescSchema = z.looseObject({ name: z.string(), description: z.string() });
export type GarlandNameDesc = z.infer<typeof garlandNameDescSchema>;

/**
 * 每份文档都带的四个语种。`tc`（繁体中文）与 `ko` 在核对过的那些文档上存在，这里却列为可选：两个 userscript 手写
 * 的副本只列了四个，那本身就是「不是每份文档都有六个」的证据。
 */
const localizedFields = {
  name: z.string(),
  description: z.string(),
  en: garlandNameDescSchema,
  ja: garlandNameDescSchema,
  fr: garlandNameDescSchema,
  de: garlandNameDescSchema,
  tc: garlandNameDescSchema.optional(),
  ko: garlandNameDescSchema.optional(),
};

export const garlandActionSchema = z.looseObject({
  ...localizedFields,
  id: z.number(),
  icon: z.number(),
  patch: z.number().optional(),
  category: z.number().optional(),
  affinity: z.number().optional(),
  lvl: z.number().optional(),
  range: z.number().optional(),
  cast: z.number().optional(),
  recast: z.number().optional(),
  job: z.number().optional(),
  resource: z.unknown().optional(),
  cost: z.unknown().optional(),
  gcd: z.unknown().optional(),
});
export type GarlandAction = z.infer<typeof garlandActionSchema>;

export const garlandStatusSchema = z.looseObject({
  ...localizedFields,
  id: z.number(),
  icon: z.number(),
  patch: z.number().optional(),
  category: z.number().optional(),
  canDispel: z.boolean().optional(),
});
export type GarlandStatus = z.infer<typeof garlandStatusSchema>;

/**
 * 一份物品文档。
 *
 * `category` 名字听起来像物品分类，实际是一个 `ItemUICategory` 行号，现存 userscript 因此不得不在它和一个检索
 * 分类之间做一次桥接。`tradeable` 只出现在可上市的物品上，所以字段缺席的意思是「不可上市」而不是「不知道」，这与
 * 通常读一个可选字段的方式相反，`isGarlandTradeable` 就是为这条写的。
 */
export const garlandItemSchema = z.looseObject({
  ...localizedFields,
  id: z.number(),
  icon: z.number(),
  patch: z.number().optional(),
  patchCategory: z.number().optional(),
  price: z.number().optional(),
  ilvl: z.number().optional(),
  category: z.number().optional(),
  dyecount: z.number().optional(),
  tradeable: z.number().optional(),
  sell_price: z.number().optional(),
  rarity: z.number().optional(),
  unique: z.unknown().optional(),
  unlistable: z.unknown().optional(),
  stackSize: z.number().optional(),
  attr: z.unknown().optional(),
  attr_hq: z.unknown().optional(),
  quests: z.unknown().optional(),
  loots: z.unknown().optional(),
  craft: z.unknown().optional(),
  supply: z.unknown().optional(),
});
export type GarlandItem = z.infer<typeof garlandItemSchema>;

/** 只要求负载键，`ingredients` 与 `partials` 只是把 `item` 已经装的东西再说一遍。 */
export const garlandItemResponseSchema = z.looseObject({ item: garlandItemSchema });
export const garlandActionResponseSchema = z.looseObject({ action: garlandActionSchema });
export const garlandStatusResponseSchema = z.looseObject({ status: garlandStatusSchema });

export type GarlandItemResponse = z.infer<typeof garlandItemResponseSchema>;
export type GarlandActionResponse = z.infer<typeof garlandActionResponseSchema>;
export type GarlandStatusResponse = z.infer<typeof garlandStatusResponseSchema>;

export const garlandDocKinds = ['item', 'action', 'status'] as const;
export type GarlandDocKind = (typeof garlandDocKinds)[number];
