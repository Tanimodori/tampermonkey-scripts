import { z } from 'zod';

/**
 * 包内唯一值导入 zod 的文件：raw 侧只从这里取类型别名，`import type` 之后这一整块不进模块图。
 *
 * 名字跟着 API 走：`listMessages` 这一个 API，入参是 `listMessagesInputSchema` 与 `ListMessagesInput`，出参是
 * `listMessagesOutputSchema` 与 `ListMessagesOutput`。API 名（也就是它的 `operation`）在包里唯一，所以两组名字都不会撞。
 */

/** 整份入参：平铺，不含位置信息。`requestSchema` 判定的就是这一个类型。 */
export const listMessagesInputSchema = z.object({
  before: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type ListMessagesInput = z.infer<typeof listMessagesInputSchema>;

/** 调用方拿到的那一段：字段名跟着上游，类型名跟着 API。`responseSchema` 判定的是它，不是整个信封。 */
export const listMessagesOutputSchema = z.object({
  messages: z.array(z.object({ id: z.string(), text: z.string() })),
  hasMore: z.boolean(),
});
export type ListMessagesOutput = z.infer<typeof listMessagesOutputSchema>;
