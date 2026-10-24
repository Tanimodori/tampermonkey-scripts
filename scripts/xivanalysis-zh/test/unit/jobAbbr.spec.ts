import { describe, expect, it } from 'vitest';
import { createJobAbbr } from '../../src/data/jobAbbr';

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const makePageFetch = (respond: () => Response | Promise<Response>) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    calls.push({ url, init });
    return respond();
  };
  return { fn, calls };
};

const CLASS_JOB_URL = 'https://xivapi-v2.xivcdn.com/api/sheet/ClassJob?fields=Name,Abbreviation&language=chs&limit=120';

describe('jobAbbr', () => {
  it('解析国服 ClassJob，产出缩写条目并可按缩写查名', async () => {
    const { fn, calls } = makePageFetch(() =>
      jsonResponse({
        rows: [
          { fields: { Name: '占星术士', Abbreviation: 'AST' } },
          { fields: { Name: '白魔法师', Abbreviation: 'WHM' } },
          { fields: { Name: '', Abbreviation: 'BAD' } },
          { fields: { Name: '无缩写', Abbreviation: '' } },
          { fields: { Name: 'SAME', Abbreviation: 'SAME' } },
        ],
      }),
    );
    const jobAbbr = createJobAbbr({ pageFetch: fn });

    await jobAbbr.ensure();

    expect(calls).toEqual([{ url: CLASS_JOB_URL, init: { headers: { accept: 'application/json' } } }]);
    await expect(jobAbbr.provider()).resolves.toEqual([
      { kind: 'unknown', id: -1, en: 'AST', zh: '占星术士' },
      { kind: 'unknown', id: -1, en: 'WHM', zh: '白魔法师' },
    ]);
    expect(jobAbbr.name('AST')).toBe('占星术士');
    expect(jobAbbr.name('BAD')).toBeUndefined();
    expect(jobAbbr.name('SAME')).toBeUndefined();
  });

  it('非 2xx 时降级为空表，不抛出', async () => {
    const { fn } = makePageFetch(() => jsonResponse({}, 500));
    const jobAbbr = createJobAbbr({ pageFetch: fn });

    await expect(jobAbbr.ensure()).resolves.toBeUndefined();
    await expect(jobAbbr.provider()).resolves.toEqual([]);
    expect(jobAbbr.name('AST')).toBeUndefined();
  });

  it('网络异常时降级为空表，不抛出', async () => {
    const { fn } = makePageFetch(() => {
      throw new Error('network error');
    });
    const jobAbbr = createJobAbbr({ pageFetch: fn });

    await expect(jobAbbr.ensure()).resolves.toBeUndefined();
    await expect(jobAbbr.provider()).resolves.toEqual([]);
  });

  it('只请求一次，后续调用复用同一 promise', async () => {
    const { fn, calls } = makePageFetch(() => jsonResponse({ rows: [{ fields: { Name: '占星术士', Abbreviation: 'AST' } }] }));
    const jobAbbr = createJobAbbr({ pageFetch: fn });

    await Promise.all([jobAbbr.ensure(), jobAbbr.ensure()]);
    await jobAbbr.provider();

    expect(calls).toHaveLength(1);
  });
});
