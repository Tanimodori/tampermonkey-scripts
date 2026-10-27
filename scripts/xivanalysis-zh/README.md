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

`src/data/generated/statuses.json` 是按 id 排序的 status 对照表，构建时由 `src/data/statuses.ts` 直接 import，Vite 内联进产物。**构建不联网**。源文件保持 2 空格缩进便于阅读；`vite.config.ts` 开启 `json.stringify` 并关闭 named exports，Vite 会把 JSON import 转成紧凑的 `JSON.parse("...")`，缩进不进 bundle。

结构是元组 + 稀疏例外，只存运行时真正需要的子集：

```json
{
  "rows": [[1191, "Rampart", 210152, "铁壁"]],
  "enNames": { "1892": "Neutral Sect" },
  "enIcons": { "1191": 213911 },
  "zhIcons": {}
}
```

- `rows`：`[id, upstream 名, upstream 图标, 国服名]`；
- `enNames`：en 名与 upstream 名不同的例外（比较时 trim + lowercase）；
- `enIcons`：en 图标与 upstream 图标不同的例外；
- `zhIcons`：国服图标与当前 en/upstream 图标不同的例外。

en 名与 en 图标未列例外时回落到 upstream；国服图标未列 `zhIcons` 时先回落到 en 图标（若有），再回落到 upstream。`id` 是游戏 `Status` 表的 row_id，不是 FFLogs 的 `+1,000,000` ID。页面 DOM 只有英文名和图标号，没有 row_id；因此运行时仍以页面可见的 upstream 英文名 + 图标为入口：先匹配 upstream name，未命中再匹配 en name，同名多 id 时用 upstream/en/zh 图标消歧（优先 upstream icon，其次 en/zh）。名称未命中时不按 icon 抢答。

```bash
rushx update:data                   # 只更新 status 烘焙（同 bake:statuses）
rushx update:data:corpus            # 同时跑约 50 分钟的语料 capture
rushx bake:statuses                 # 重新生成 status 数据（联网）
rushx bake:statuses:verify          # 离线校验 data 与 meta 的 hash/条目数/字段
rushx bake:statuses:check-upstream  # 只比较 meta 里的上游 commit
```

`bake:statuses` 默认跟随 `dawntrail` 分支，同时查上游源码与英文/国服 xivapi，并把实际 commit、国服版本、数据 hash 写进 `statuses.meta.json`；需要固定版本时用 `--sha <commit>`。生成文件要一起提交，`statuses.meta.json` 不参与打包。

告警直接输出到 stderr，不写入 meta；缺中文默认失败（`--allow-missing` 可放行），缺英文只告警并在记录中省略 `en`。数据源边界见 [docs/data-sources.md](docs/data-sources.md)。

## build

`rushx build`
