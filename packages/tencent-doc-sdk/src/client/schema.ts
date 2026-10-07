import { z } from 'zod';

/**
 * client 层的线上契约：信封头，任何判定之前先读它。
 *
 * 本模块里唯一做剥除的 schema——它只取两个字段走判定，答复其余部分由各端点自己的响应 schema 读。
 */

/**
 * 信封头，任何判定之前先读它。
 *
 * 宽松：读不出 `ret` 的答复交给判定层处理，而不是在这里就被拒。
 */
export const answerHeaderSchema = z.object({ ret: z.number().optional(), msg: z.string().optional() });

export type AnswerHeader = z.infer<typeof answerHeaderSchema>;
