import { describe, expect, it } from 'vitest';
import { overrideProvider } from '../../src/data/override';

describe('override 完整性', () => {
  it('每条都有译文或 modifier，且英文不重复', async () => {
    const entries = await overrideProvider();
    const seen = new Set<string>();

    for (const entry of entries) {
      expect(entry.en.trim(), entry.en).toBeTruthy();
      expect(Boolean(entry.zh || entry.modifier), entry.en).toBe(true);
      expect(seen.has(entry.en), entry.en).toBe(false);
      seen.add(entry.en);
    }
  });
});
