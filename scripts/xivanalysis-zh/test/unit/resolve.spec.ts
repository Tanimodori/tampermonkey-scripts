import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetUntranslated, untranslatedList } from '../../src/data/ignore';
import { createResolve, resolve, warnSearch } from '../../src/data/resolve';
import { addEntry, fetchProvider, onMapGrowth, recordPair, resetStore } from '../../src/data/store';
import type { XivEntry } from '../../src/types/workflow';
import { KNOWN, isTarget, known } from '../../src/utils';

const fire: XivEntry = { kind: 'action', id: 1, en: 'Fire', zh: '火炎', iconId: 405 };

beforeEach(() => {
  resetStore();
  KNOWN.clear();
  resetUntranslated();
});

describe('store', () => {
  it('recordPair 写回 store 与 known', async () => {
    recordPair('action', 'Name', { row_id: 1, fields: { Name: 'Fire', Icon: { id: 405 } } }, { row_id: 1, fields: { Name: '火炎' } });

    await expect(fetchProvider()).resolves.toEqual([fire]);
    expect(known('Fire')).toBe(true);
    expect(isTarget('Fire')).toBe(false);
  });

  it('addEntry 拒绝同文与空值，新条目通知增长', () => {
    const listener = vi.fn();
    const off = onMapGrowth(listener);

    expect(addEntry({ kind: 'action', id: 1, en: 'Fire', zh: 'Fire' })).toBe(false);
    expect(addEntry({ kind: 'action', id: 1, en: '', zh: '火炎' })).toBe(false);
    expect(addEntry(fire)).toBe(true);
    expect(addEntry({ ...fire, id: 2, zh: '火炎 II' })).toBe(false);

    expect(listener).toHaveBeenCalledOnce();
    off();
  });

  it('缓存随映射增长失效', async () => {
    addEntry(fire);
    const first = await fetchProvider();
    addEntry({ kind: 'action', id: 2, en: 'Cure', zh: '治疗' });
    const second = await fetchProvider();

    expect(first).not.toBe(second);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);
  });
});

describe('resolve', () => {
  it('按顺序短路，首个非空结果即返回', async () => {
    const first = vi.fn(async () => [fire]);
    const second = vi.fn(async () => [{ ...fire, zh: '第二来源' }]);

    await expect(createResolve([first, second])({ en: 'Fire' })).resolves.toEqual([fire]);
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it('全部来源为空时返回空数组', async () => {
    await expect(createResolve([async () => [], async () => []])({ en: 'Nothing' })).resolves.toEqual([]);
  });

  it('默认链能命中 override 与 baked 状态', async () => {
    await expect(resolve({ en: 'GCD' })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ en: 'GCD', zh: 'GCD' })]));
    await expect(resolve({ en: 'Regen' })).resolves.toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'status', en: 'Regen' })]));
  });

  it('warnSearch 上报未覆盖英文并返回空数组', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(warnSearch({ en: 'Nothing' })).resolves.toEqual([]);

    expect(untranslatedList()).toEqual(['Nothing']);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
