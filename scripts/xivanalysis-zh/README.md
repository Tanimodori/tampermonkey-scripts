# xivanalysis-zh

Display actions and status of xivanalysis report in Chinese.

![TS100%](https://badgen.net/badge/TypeScript/100%25/3178C6?icon=typescript)

Install this scirpt at [GreasyFork](https://greasyfork.org/zh-CN/scripts/523443-xivanalysis-zh).

## develop

`pnpm i`

## test

`rushx test:unit` 跑 unit、DOM（jsdom）与权威覆盖率测试，全部离线。

Playwright 分组：

- `rushx test:e2e:fast` —— 离线夹具 + 快速注入，判注入时机与安装。
- `rushx test:e2e:full` —— 离线夹具 + 真 Tampermonkey，判安装与 `@match`。
- `rushx test:live:upstream` —— 真实英文、国服、ClassJob 与 garland 契约。
- `rushx test:live:smoke` —— 一条真实战报 + 快速注入。
- `rushx test:corpus:capture` —— 手工刷新 33 条战报语料，约 50 分钟，不属于门禁。
- `rushx test:gate:offline` —— unit + typecheck + build + 两组离线 e2e。
- `rushx test:gate:live` —— 上游契约 + 一条真实战报 smoke。

测试维度、每条用例与预期见 [docs/test-matrix.md](docs/test-matrix.md)；e2e 的分组与踩坑见 [test/e2e/README.md](test/e2e/README.md)。

## 状态表烘焙

`src/data/generated/statuses.json` 是 xivanalysis `STATUSES` 的英文名/icon 与国服简中名的静态合并结果，构建时由 `src/data/statuses.ts` 直接 import，Vite 内联进产物。**构建不联网**。

```bash
rushx update:data                   # 只更新 status 烘焙（同 bake:statuses）
rushx update:data:icons             # 同时富化 iconDrift
rushx update:data:corpus            # 同时跑约 50 分钟的语料 capture
rushx bake:statuses                 # 只更新 status 数据（联网）
rushx bake:statuses:check-icons     # 额外核对 icon 漂移的归属行（联网）
rushx bake:statuses:verify          # 离线校验 data 与 meta 的 hash/条目数/字段
rushx bake:statuses:check-upstream  # 只比较 meta 里的上游 commit
```

`bake:statuses` 默认跟随 `dawntrail` 分支并把实际 commit 写进 `statuses.meta.json`；需要固定版本时用 `--sha <commit>`。生成文件要一起提交，`statuses.meta.json` 不参与打包。

`statuses.json` 每条的 `id` 是游戏 `Status` 表的 row_id，不是 FFLogs 的 `+1,000,000` ID；`iconId` 是上游 xivanalysis/页面侧的显示图标，不是国服 `Icon.id`。英文和国服 xivapi 对同一行返回相同的 `Icon.id`；`statuses.meta.json` 的 `diagnostics.iconDrift` 记录上游 icon 与当前游戏数据不一致的条目及其归属：当前 22 条中，3 条是上游 id/icon 指向同名不同行（Rampart 1191 的 210152 属于 71/1978，Requiescat 1368 的 212514 属于 1369，Radiant Finale 2964 的 212622 属于 2722），13 条的旧图标已不在当前 sheet，6 条属于其他名称（例如 Atonement Ready 的 210207 属于 Greased Lightning）。这不是中英文数据漂移，也不影响按名称取中文；名称仍是翻译的主键，icon 只用于同名消歧。

`rushx bake:statuses:check-icons` 会额外用 xivapi 的 `Icon=` 检索补全 `iconDrift` 的归属行和判定；标准 `bake:statuses` 不发这些额外请求，但只要上游 commit 与国服版本没变，会保留已有的富集结果。数据源边界见 [docs/data-sources.md](docs/data-sources.md)。

## build

`rushx build`
