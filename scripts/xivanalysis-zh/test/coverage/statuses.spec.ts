import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import meta from '../../src/data/generated/statuses.meta.json';
import { bakedStatuses, bakedStatusNameCount, bakedStatusSearch } from '../../src/data/statuses';

const DATA_URL = new URL('../../src/data/generated/statuses.json', import.meta.url);

describe('烘焙状态表', () => {
  it('data 与 meta 的 hash、条目数一致', () => {
    const bytes = readFileSync(DATA_URL);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.dataSha256);
    expect(bakedStatuses).toHaveLength(meta.entriesCount);
    expect(meta.upstream.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('每条都是完整的 status 条目', () => {
    expect(bakedStatuses.length).toBeGreaterThan(300);
    for (const entry of bakedStatuses) {
      expect(entry.kind).toBe('status');
      expect(entry.id).toBeGreaterThan(0);
      expect(entry.en.length).toBeGreaterThan(0);
      expect(entry.zh.length).toBeGreaterThan(0);
      expect(entry.zh).not.toBe(entry.en);
      if (entry.iconId != null) expect(entry.iconId).toBeGreaterThan(0);
    }
  });

  it('按英文名命中,大小写不敏感', async () => {
    const hits = await bakedStatusSearch({ en: 'Regen' });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ kind: 'status', id: 158, en: 'Regen', zh: '再生', iconId: 212626 });

    const lower = await bakedStatusSearch({ en: 'regen' });
    expect(lower).toHaveLength(1);
    expect(lower[0].zh).toBe('再生');
  });

  it('同名多义时用 icon 收窄,名称仍未命中时不按 icon 抢答', async () => {
    const hits = await bakedStatusSearch({ en: 'Regen', iconId: 212626 });
    expect(hits).toHaveLength(1);
    expect(hits[0].iconId).toBe(212626);

    // 状态表只有 status;未知英文名即使 icon 撞上,也不能替技能作答。
    await expect(bakedStatusSearch({ en: 'Definitely Not A Status', iconId: 212626 })).resolves.toEqual([]);
  });

  it('kind 不是 status 时不出手', async () => {
    await expect(bakedStatusSearch({ en: 'Regen', kind: 'action' })).resolves.toEqual([]);
  });

  it('没有 en 时才按 icon 查', async () => {
    const hits = await bakedStatusSearch({ iconId: 212626 });
    expect(hits.some((entry) => entry.en === 'Regen')).toBe(true);
  });

  it('同名多条目按烘焙表顺序返回,首个是确定的', async () => {
    const name = ['Seraphism', 'Tsubame-Gaeshi'].find((candidate) => bakedStatusNameCount(candidate) > 1);
    expect(name).toBeTruthy();
    if (!name) return;

    const hits = await bakedStatusSearch({ en: name });
    expect(hits.length).toBeGreaterThan(1);
    expect(hits).toEqual(bakedStatuses.filter((entry) => entry.en.toLowerCase() === name.toLowerCase()));
  });
});
