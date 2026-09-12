import { describe, vi, it } from 'vitest';
import { run } from '@/entry';
import { buildDocument } from './builder';
import { testCases } from './cases';

describe('inject functions', () => {
  it.each(testCases)('can render table', (testCase) => {
    const window = buildDocument(testCase);
    vi.stubGlobal('document', window.document);
    run();
  });
});
