import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportUntranslated, resetUntranslated, untranslatedList } from '../../src/data/ignore';

afterEach(() => {
  resetUntranslated();
  vi.restoreAllMocks();
});

describe('未覆盖告警', () => {
  it('同一英文串只 warn 一次', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    reportUntranslated('Fire');
    reportUntranslated('Fire');
    reportUntranslated('  Fire  ');

    expect(warn).toHaveBeenCalledOnce();
    expect(untranslatedList()).toEqual(['Fire']);
  });

  it('空串与空白不记录', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    reportUntranslated('');
    reportUntranslated('   ');

    expect(warn).not.toHaveBeenCalled();
    expect(untranslatedList()).toEqual([]);
  });
});
