import { describe, expect, it } from 'vitest';
import { garlandSearchResponseSchema } from '@/endpoints/search/schema';
import { createGarlandClient, garlandDocUrl, garlandSearch, readAction, readItem, readStatus } from '@/index';

/**
 * 对真实镜像运行——`https://www.garlandtools.cn`——手动跑：`rushx test:live`。
 *
 * 两道闸，不是一道。`live` 标签把这些挡在带过滤的运行之外，`skipIf` 把它们挡在不带过滤的运行之外——vitest
 * 把"没有过滤"读成"全都跑"，只有标签挡不住一次普通的 `rushx test` 去碰网络。两道都同意，请求才离开机器。
 */
const live = process.env.XIV_LIVE === '1';

describe.skipIf(!live)('garland mirror', { tags: ['live'] }, () => {
  const client = () => createGarlandClient();

  it('reads a document of each kind', async () => {
    expect((await client().call(readItem, { id: 19890 })).item.id).toBe(19890);
    expect((await client().call(readAction, { id: 16554 })).action.id).toBe(16554);
    expect((await client().call(readStatus, { id: 1892 })).status.id).toBe(1892);
  });

  it('still answers search in both scripts', async () => {
    const english = await client().call(garlandSearch, { text: 'Fire', lang: 'en', type: 'action' });
    expect(english.length).toBeGreaterThan(0);
    expect(garlandSearchResponseSchema.safeParse(english).success).toBe(true);
  });

  it('allows any origin', async () => {
    const response = await fetch(garlandDocUrl('item', 19890));
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('confirms the addresses this package hard-codes still resolve', async () => {
    for (const [kind, id] of [
      ['item', 19890],
      ['action', 16554],
      ['status', 1892],
    ] as const) {
      const url = garlandDocUrl(kind, id);
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      // 三种文档各自的 schema 段不同，某一条答 200 只说明拼出来的那一条地址成立，所以逐条量。
      expect(response.status, url.toString()).toBe(200);
      // 这台主机允许任意来源，是 `@grant none` 能工作的全部依据。
      expect(response.headers.get('access-control-allow-origin'), `CORS gone on ${url}`).toBe('*');
    }
  });
});
