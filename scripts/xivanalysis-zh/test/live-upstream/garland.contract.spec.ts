import { describe, expect, it } from 'vitest';

/**
 * garland 真实契约：search.php 没有 ACAO，浏览器里够不着，因此用 Node fetch 验证形状。
 * 这条不属于离线单测，由 test:live:upstream 显式运行。
 */
describe('garland 实时契约', () => {
  it('search.php 返回精确同名的命中，且带 obj.i', async () => {
    const res = await fetch('https://www.garlandtools.cn/api/search.php?text=Fire&lang=en', {
      headers: { accept: 'application/json' },
    });
    expect(res.ok).toBe(true);
    const hits = (await res.json()) as { obj?: { i?: unknown; n?: unknown } }[];
    const hit = hits.find((item) => item.obj?.n === 'Fire');
    expect(hit).toBeTruthy();
    expect(typeof hit?.obj?.i).toBe('number');
  }, 30_000);
});
