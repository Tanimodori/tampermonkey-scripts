import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import data from '../../src/data/generated/statuses.json';
import meta from '../../src/data/generated/statuses.meta.json';
import { bakedStatusById, bakedStatuses, bakedStatusNameCount, bakedStatusSearch } from '../../src/data/statuses';

const DATA_URL = new URL('../../src/data/generated/statuses.json', import.meta.url);

describe('烘焙状态表', () => {
  it('data 与 meta 的 hash、条目数、格式版本一致', () => {
    const bytes = readFileSync(DATA_URL);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.data.sha256);
    expect(bakedStatuses).toHaveLength(meta.data.entries);
    expect(meta.formatVersion).toBe(4);
    expect(meta.upstream.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(meta.cn.version.length).toBeGreaterThan(0);
    expect(meta).not.toHaveProperty('diagnostics');
    expect(meta).not.toHaveProperty('warnings');
    expect(meta).not.toHaveProperty('counts');
  });

  it('statuses.json 是保留缩进的元组 + 稀疏例外', () => {
    const text = readFileSync(DATA_URL, 'utf8');
    expect(text).toContain('\n  "rows": [');
    const enNames: Record<string, string> = data.enNames;
    const enIcons: Record<string, number> = data.enIcons;
    const zhIcons: Record<string, number> = data.zhIcons;
    expect(data.rows).toHaveLength(bakedStatuses.length);
    for (const [index, row] of data.rows.entries()) {
      expect(row).toHaveLength(4);
      const record = bakedStatuses[index];
      expect(row).toEqual([record?.id, record?.upstream.name, record?.upstream.icon, record?.zh.name]);
    }
    expect(Object.keys(enNames).length).toBeGreaterThan(0);
    expect(Object.keys(enIcons).length).toBeGreaterThan(0);
    expect(zhIcons).toBeTypeOf('object');

    for (const entry of bakedStatuses) {
      const key = String(entry.id);
      if (entry.en && entry.en.name.trim().toLowerCase() !== entry.upstream.name.trim().toLowerCase()) {
        expect(enNames[key]).toBe(entry.en.name);
      } else {
        expect(enNames[key]).toBeUndefined();
      }
      if (entry.en && entry.en.icon !== entry.upstream.icon) {
        expect(enIcons[key]).toBe(entry.en.icon);
      } else {
        expect(enIcons[key]).toBeUndefined();
      }
      const zhIcon = zhIcons[key];
      if (zhIcon !== undefined) {
        expect(zhIcon).toBe(entry.zh.icon);
        expect(zhIcon).not.toBe(entry.en?.icon ?? entry.upstream.icon);
      }
    }
  });

  it('没有例外时 en/zh 回落到 upstream 默认值', () => {
    const regen = bakedStatusById(158);
    expect(regen?.en).toBeUndefined();
    expect(regen?.zh).toMatchObject({ name: '再生', icon: 212626 });

    expect(bakedStatusById(1191)?.en).toMatchObject({ name: 'Rampart', icon: 213911 });
    expect(bakedStatusById(1892)?.en).toMatchObject({ name: 'Neutral Sect', icon: 213253 });
    expect(bakedStatusById(1892)?.zh.icon).toBe(213253);
  });

  it('每条记录都有 upstream/zh,en 可选,id 唯一且升序', () => {
    expect(bakedStatuses.length).toBeGreaterThan(300);
    let previousId = 0;
    for (const entry of bakedStatuses) {
      expect(entry.id).toBeGreaterThan(previousId);
      previousId = entry.id;
      expect(entry.upstream.name.length).toBeGreaterThan(0);
      expect(entry.upstream.icon).toBeGreaterThan(0);
      expect(entry.zh.name.length).toBeGreaterThan(0);
      expect(entry.zh.icon).toBeGreaterThan(0);
      expect(entry.zh.name).not.toBe(entry.upstream.name);
      if (entry.en) {
        expect(entry.en.name.length).toBeGreaterThan(0);
        expect(entry.en.icon).toBeGreaterThan(0);
      }
    }
  });

  it('按 upstream 英文名命中,大小写不敏感', async () => {
    const hits = await bakedStatusSearch({ en: 'Regen' });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: 'status', id: 158, en: 'Regen', zh: '再生', iconId: 212626 });

    const lower = await bakedStatusSearch({ en: 'regen' });
    expect(lower).toHaveLength(1);
    expect(lower[0]?.zh).toBe('再生');
  });

  it('显式 id 直接命中,未知 id 返回空', async () => {
    await expect(bakedStatusSearch({ id: 1191 })).resolves.toEqual([{ kind: 'status', id: 1191, en: 'Rampart', zh: '铁壁', iconId: 210152 }]);
    await expect(bakedStatusSearch({ id: 999999 })).resolves.toEqual([]);
    expect(bakedStatusById(1191)?.zh.name).toBe('铁壁');
  });

  it('upstream 名未命中时回退到 en 名,并可用页面 icon 收窄', async () => {
    const records = bakedStatuses.filter((entry) => entry.en?.name === 'Neutral Sect');
    expect(records).toHaveLength(2);
    const target = records[1];
    if (!target?.en) throw new Error('缺少 Neutral Sect 的 en 数据');

    const hits = await bakedStatusSearch({ en: 'Neutral Sect', iconId: target.en.icon });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe(target.id);
  });

  it('upstream 名优先于 en 名,即使 icon 指向另一条记录', async () => {
    const records = bakedStatuses.filter((entry) => entry.en?.name === 'Neutral Sect');
    const barrier = records.find((entry) => entry.upstream.name === 'Neutral Sect (Barrier)');
    const healing = records.find((entry) => entry.upstream.name === 'Neutral Sect (Healing Potency)');
    if (!barrier?.en || !healing?.en) throw new Error('缺少 Neutral Sect 的对照数据');

    const hits = await bakedStatusSearch({ en: 'Neutral Sect (Barrier)', iconId: healing.en.icon });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.id).toBe(barrier.id);
  });

  it('同名多 id 先按 upstream icon 收窄,再按 en/zh icon 收窄', async () => {
    const records = bakedStatuses.filter((entry) => entry.upstream.name === 'Embolden');
    expect(records).toHaveLength(2);
    const first = records[0];
    const second = records[1];
    if (!first?.en || !second?.en) throw new Error('缺少 Embolden 的对照数据');
    expect(first.upstream.icon).not.toBe(first.en.icon);
    expect(second.upstream.icon).not.toBe(second.en.icon);

    await expect(bakedStatusSearch({ en: 'Embolden', iconId: first.upstream.icon })).resolves.toMatchObject([{ id: first.id }]);
    await expect(bakedStatusSearch({ en: 'Embolden', iconId: second.en.icon })).resolves.toMatchObject([{ id: second.id }]);

    const fallback = await bakedStatusSearch({ en: 'Embolden', iconId: 999999 });
    expect(fallback.map((entry) => entry.id)).toEqual([first.id, second.id]);
  });

  it('名称未命中时不按 icon 抢答', async () => {
    await expect(bakedStatusSearch({ en: 'Definitely Not A Status', iconId: 212626 })).resolves.toEqual([]);
  });

  it('kind 不是 status 时不出手', async () => {
    await expect(bakedStatusSearch({ en: 'Regen', kind: 'action' })).resolves.toEqual([]);
  });

  it('没有 en 时才按 upstream icon 查,不用当前图标', async () => {
    const hits = await bakedStatusSearch({ iconId: 212626 });
    expect(hits.some((entry) => entry.en === 'Regen')).toBe(true);

    const drift = bakedStatuses.find((entry) => entry.en && entry.en.icon !== entry.upstream.icon);
    if (!drift?.en) throw new Error('缺少 icon 漂移样本');
    const byCurrentIcon = await bakedStatusSearch({ iconId: drift.en.icon });
    expect(byCurrentIcon.some((entry) => entry.id === drift.id)).toBe(false);
  });

  it('同名多条目按 id 升序返回,首个是确定的', async () => {
    const name = ['Seraphism', 'Tsubame-Gaeshi'].find((candidate) => bakedStatusNameCount(candidate) > 1);
    expect(name).toBeTruthy();
    if (!name) return;

    const hits = await bakedStatusSearch({ en: name });
    expect(hits.length).toBeGreaterThan(1);
    expect(hits.map((entry) => entry.id)).toEqual(
      bakedStatuses.filter((entry) => entry.upstream.name.toLowerCase() === name.toLowerCase()).map((entry) => entry.id),
    );
  });
});
