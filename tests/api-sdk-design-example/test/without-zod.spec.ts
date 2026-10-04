import { describe, it } from 'vitest';
import { listMessagesRaw } from '@/index';
import { SCENARIOS } from './scenarios';

/**
 * 不带 zod 装配下，一次调用的错误处理：与带 zod 那一份共用 `scenarios.ts` 的同一张表，断言逐字相同。
 */

describe('不带 zod 装配', () => {
  it.each(SCENARIOS)('$label', ({ run }) => run(listMessagesRaw));
});
