import { z } from 'zod';

/**
 * 包内唯一值导入 zod 的文件。raw 侧只从这里取类型别名，`import type` 之后这一整块不进模块图。
 *
 * 命名跟 API。`listMessages` 的入参是 `listMessagesInputSchema` 与 `ListMessagesInput`，出参是 `listMessagesOutputSchema` 与
 * `ListMessagesOutput`。API 名（也就是 `operation`）在包里唯一，入参、出参的名字不会撞。
 */

/** 整份入参平铺，不含位置信息。 */
export const listMessagesInputSchema = z.object({
  before: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type ListMessagesInput = z.infer<typeof listMessagesInputSchema>;

/** 调用方拿到的那一段，字段名跟着上游，类型名跟着 API。 */
export const listMessagesOutputSchema = z.object({
  messages: z.array(z.object({ id: z.string(), text: z.string() })),
  hasMore: z.boolean(),
});
export type ListMessagesOutput = z.infer<typeof listMessagesOutputSchema>;
