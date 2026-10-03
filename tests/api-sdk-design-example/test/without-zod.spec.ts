import { describe, it } from 'vitest';
import { testEndpoint } from './fixtures';
import { SCENARIOS } from './scenarios';

/**
 * 重心之二：不带 zod 装配下，一次调用的错误处理。
 *
 * 与带 zod 那一份共用 `scenarios.ts` 的同一张表，所以两份装配并排跑的是逐字相同的一组断言。
 */

describe('不带 zod 装配', () => {
  it.each(SCENARIOS)('$label', ({ run }) => run(testEndpoint.withoutZod));
});
