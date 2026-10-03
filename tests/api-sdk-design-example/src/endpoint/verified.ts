import { listMessagesRaw } from './raw';
import { listMessagesInputSchema, listMessagesOutputSchema } from './schema';

/** 带判定的装配：展开 `raw` 那一份，只补两个校验槽，两个适配器是同一个函数对象。默认名字归它，无判定的那一份带 `Raw` 后缀。 */
export const listMessages: typeof listMessagesRaw = {
  ...listMessagesRaw,
  requestSchema: listMessagesInputSchema,
  responseSchema: listMessagesOutputSchema,
};
