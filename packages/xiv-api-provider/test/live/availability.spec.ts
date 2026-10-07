import { ApiErrorCodes, isApiError } from 'api-sdk-framework';
import { describe, expect, it } from 'vitest';
import * as schemas from '@/endpoints/schema.ts';
import {
  ALL_EDITIONS,
  createXivApiClient,
  EDITIONS,
  isApiErrorResponse,
  isSheetResponse,
  languageRejectionKind,
  listSheets,
  listVersions,
  readAsset,
  readRow,
  search,
} from '@/index.ts';

/**
 * 对真实服务运行，手动跑：`rushx test:live`。
 *
 * 两道闸，不是一道。`live` 标签把这些挡在带过滤的运行之外，`skipIf` 把它们挡在不带过滤的运行之外——vitest
 * 把"没有过滤"读成"全都跑"，只有标签挡不住一次普通的 `rushx test` 去碰网络。两道都同意，请求才离开机器。
 *
 * zod schema 在这里挣它的工资：它们校验*返回*的 body，那是迁移探测器。一份提交过的夹具只能证明代码与过去
 * 一致。
 */
const live = process.env.XIV_LIVE === '1';

/** 两个 edition 都会渲染的一张源纹理。`.png` 路径不可转换，所以它是不对的探针。 */
const ICON = 'ui/icon/003000/003554.tex';

describe.skipIf(!live)('xivapi, both editions', { tags: ['live'] }, () => {
  for (const edition of ALL_EDITIONS) {
    describe(edition, () => {
      const client = () => createXivApiClient(edition);

      it('answers a sheet read with the documented envelope', async () => {
        const row = await client().call(readRow, { sheet: 'Action', row: 16554, query: { fields: ['Name', 'Icon'] } });
        expect(row.row_id).toBe(16554);
        expect(typeof row.fields.Name).toBe('string');
      });

      it('lists sheets', async () => {
        const listed = await client().call(listSheets, {});
        expect(listed.sheets.map((sheet) => sheet.name)).toContain('Item');
      });

      it('serves the language the edition is configured with', async () => {
        const row = await client().call(readRow, { sheet: 'Action', row: 16554, query: { fields: ['Name'] } });
        // 不断言内容——只要回来了一个名字、且形状 parse 得过。
        expect(schemas.rowResponseSchema.safeParse({ schema: 'exdschema@2:rev:0000000000000000000000000000000000000000', version: '0', ...row }).success).toBe(
          true,
        );
      });

      it('answers a clause search', async () => {
        // 裸词在两个 edition 上都不是合法的查询语法。这里的空列表是一个正确回答，所以只查形状；国服索引
        // 能不能把它填满，是下面它自己的一条。
        const result = await client().call(search, { query: 'Name="Potion"', sheets: ['Item'], limit: 1, fields: ['Name'] });
        expect(result.results.length).toBeLessThanOrEqual(1);
        expect(schemas.searchResponseSchema.safeParse(result).success).toBe(true);
      });
    });
  }

  it('has a version list internationally', async () => {
    const versions = await createXivApiClient('international').call(listVersions, {});
    expect(versions.versions.length).toBeGreaterThan(3);
    expect(versions.versions.at(-1)?.names.length).toBeGreaterThan(0);
  });

  it('allows any origin, which is what `@grant none` depends on', async () => {
    for (const edition of ALL_EDITIONS) {
      const response = await fetch(`${EDITIONS[edition].apiBase}/sheet/Item/19890?fields=Name`);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
    }
  });
});

/**
 * 每个 edition 实际服务什么，一次一条请求地量。
 *
 * 国服是 userscript 需要的那台、也是不一样的那台，所以这是调用方无法从共享的 client 类型推断的部分：同一个
 * 端点要么回答、要么换种方式回答、要么根本没有路由。`createXivApiClient` 有意不对这些分支——想避开一次注
 * 定失败的请求的调用方，自己读这张表、自己决定。
 */
describe.skipIf(!live)('edition capabilities', { tags: ['live'] }, () => {
  const international = () => createXivApiClient('international');
  const chinese = () => createXivApiClient('chinese-server');

  it('serves far fewer sheets on the Chinese mirror', async () => {
    const [intl, cn] = await Promise.all([international().call(listSheets, {}), chinese().call(listSheets, {})]);
    expect(cn.sheets.length).toBeGreaterThan(1_000);
    expect(cn.sheets.length).toBeLessThan(intl.sheets.length / 2);
    console.info(`sheets: international ${intl.sheets.length}, chinese-server ${cn.sheets.length}`);
  });

  it('serves `chs` on the mirror and refuses that token internationally', async () => {
    // `chs` 是只有国服认的真 token，这也是国服顺带答对国际站形状请求的原因：在那边省掉 `language` 本来
    // 就出中文。
    const chineseName = await chinese().call(readRow, { sheet: 'Item', row: 1, query: { language: 'chs', fields: ['Name'] } });
    expect(typeof chineseName.fields.Name).toBe('string');

    const error = await international()
      .call(readRow, { sheet: 'Item', row: 1, query: { language: 'chs' } })
      .catch((caught: unknown) => caught);
    expect(isApiError(error) && error.errorCode).toBe(ApiErrorCodes.BAD_REQUEST);
    expect(isApiError(error) && error.response?.status).toBe(400);
    expect(isApiError(error) && languageRejectionKind(error.message)).toBe('unsupported-for-edition');
  });

  it('serves only `chs` on the mirror, refusing the four tokens the global client carries', async () => {
    // 与上一条互补：国服镜像只留了 `chs`，`en`/`ja`/`de`/`fr` 在那边得到国际站拒 `chs` 的那种 400。这正是
    // `EDITION_LANGUAGES` 记下的能力事实，所以逐 token 打一遍。
    for (const language of ['en', 'ja', 'de', 'fr'] as const) {
      const error = await chinese()
        .call(readRow, { sheet: 'Item', row: 1, query: { language } })
        .catch((caught: unknown) => caught);
      expect(isApiError(error) && error.response?.status, language).toBe(400);
      expect(isApiError(error) && languageRejectionKind(error.message), language).toBe('unsupported-for-edition');
    }
    const defaulted = await chinese().call(readRow, { sheet: 'Item', row: 1, query: { fields: ['Name'] } });
    expect(typeof defaulted.fields.Name).toBe('string');
  });

  it('has a version list on the mirror too, in its own envelope', async () => {
    // 国服镜像曾经对 `/version` 回零正文 404；现在它与 `/versions` 一起被声明并回答。信封比国际站多
    // `key`/`published_at`/`update` 几个字段，`versions[].key` 与 `names` 仍与国际站同形。
    const listed = await chinese().call(listVersions, {});
    expect(listed.versions.length).toBeGreaterThan(0);
    expect(listed.versions.at(-1)?.names.length).toBeGreaterThan(0);
    expect(schemas.versionsResponseSchema.safeParse(listed).success).toBe(true);
  });

  it('renders an asset on both, and ignores `format` only on the mirror', async () => {
    const png = await international().call(readAsset, { path: ICON, format: 'png' });
    const askedPng = await chinese().call(readAsset, { path: ICON, format: 'png' });
    const askedJpg = await chinese().call(readAsset, { path: ICON, format: 'jpg' });
    expect(png.contentType).toBe('image/png');
    // 要 png 与要 jpg 得到同一份 webp：这个 edition 上，内容类型必须从响应读，永远不能从请求想当然。
    expect(askedPng.contentType).toBe('image/webp');
    expect(askedJpg.contentType).toBe(askedPng.contentType);
    expect(askedPng.bytes.byteLength).toBeGreaterThan(0);
  });

  it('answers the composed-map route on both, with a JSON error on the mirror', async () => {
    // 国服镜像曾经整条路由不存在（纯文本 404）；现在它声明并回答这条路由，只是没有合成地图，对任何
    // territory 都回 400 `{code, message}`——与国际站同形态、不同含义的 404 因此分得开。
    const internationalResponse = await fetch(`${EDITIONS.international.apiBase}/asset/map/81/1?format=png`);
    const chineseResponse = await fetch(`${EDITIONS['chinese-server'].apiBase}/asset/map/81/1?format=png`);
    expect([internationalResponse.status, chineseResponse.status]).toEqual([404, 400]);
    expect(schemas.apiErrorSchema.safeParse(await internationalResponse.json()).success).toBe(true);
    expect(schemas.apiErrorSchema.safeParse(await chineseResponse.json()).success).toBe(true);
  });

  it('matches a Latin clause only where that language is served', async () => {
    // 子句比拼的是"所请求语言的那个字段"里的名字。国际站有 `en` 列，英文子句在那边有命中；国服镜像只服务
    // `chs`，同一条子句在那边（显式 `chs` 或省略参数）回空列表——那是"没有这个名字的中文行"这个正确答案，
    // 也是搜索框必须把文本语言与 edition 一起考虑的原因。
    const clause = { query: 'Name="Potion"', sheets: ['Item'] as const, limit: 2, fields: ['Name'] };
    const international = await createXivApiClient('international').call(search, clause);
    const mirrorInChinese = await createXivApiClient('chinese-server').call(search, { ...clause, language: 'chs' });

    expect(international.results.length).toBeGreaterThan(0);
    expect(mirrorInChinese.results).toEqual([]);
    expect(schemas.searchResponseSchema.safeParse(mirrorInChinese).success).toBe(true);
  });
});

describe.skipIf(!live)('dead and legacy hosts', { tags: ['live'] }, () => {
  it('records that the v1 cafemaker host is unreachable', async () => {
    // 不是要修的失败，而是一个要留意的既成事实：那个 `{Pagination, Results, SpeedMs}` 信封这个包根本
    // 没有建模，所以一台主机活回来是它的读者的迁移，不是本包欠下的改动。
    const status = await fetch('https://cafemaker.wakingsands.com/search?string=x&indexes=item')
      .then((response) => response.status)
      .catch(() => 0);
    if (status !== 0 && status < 500) console.warn(`cafemaker.wakingsands.com answered ${status} — the host is serving again.`);
    expect([0, ...Array.from({ length: 500 }, (_u, index) => 500 + index)]).toContain(status);
  });

  it('sees the retired XIVAPI application answer its own 404 for xivapi.com', async () => {
    const response = await fetch('https://xivapi.com/api/1/sheet/Action?limit=1');
    const body: unknown = await response.json().catch(() => null);
    expect(response.status).toBe(404);
    // 另一个应用发来的 body：没有 `schema`、没有 `version`，连两个活着的 edition 都会发的 `{code, message}`
    // 都没有，所以本包没有一个谓词认它。
    expect(schemas.sheetResponseSchema.safeParse(body).success).toBe(false);
    expect([isSheetResponse(body), isApiErrorResponse(body)]).toEqual([false, false]);
  });

  it('still serves the v2 envelope under beta.xivapi.com’s older /api/1/ path', async () => {
    const url = 'https://beta.xivapi.com/api/1/sheet/Action?limit=1';
    const body = (await fetch(url).then((response) => response.json())) as unknown;
    expect(schemas.sheetResponseSchema.safeParse(body).success).toBe(true);
    if (!isSheetResponse(body)) throw new Error('beta.xivapi.com no longer answers the v2 envelope — the older path has changed');
    // 路径带着一个 body 没有的版本段：同一个信封、同一份数据修订，和 v2.xivapi.com 服务的一样，所以
    // `/api/1/` 是某个页面还在用的地址，而不是又一代数据。
    expect(body.version).toBeTruthy();
    // 它也不是任何一个配置过的 edition，这是关于主机的事实，不是关于 body 的。
    const editionHosts = ALL_EDITIONS.map((edition) => new URL(EDITIONS[edition].apiBase).hostname);
    expect(editionHosts).not.toContain(new URL(url).hostname);
  });
});
