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
- `rushx test:corpus:capture` —— 依次刷新 questions、responses、expected（约 50 分钟 + 接口请求），不属于门禁。
- `rushx test:corpus:questions` —— 只跑无脚本问题采集。
- `rushx test:corpus:responses` —— 只按 questions 采集独立响应。
- `rushx test:corpus:expected` —— 只用 Vitest 调用生产函数计算逐元素答案。
- `rushx test:gate:offline` —— unit + typecheck + build + 两组离线 e2e。
- `rushx test:gate:live` —— 上游契约 + 一条真实战报 smoke。

测试维度、每条用例与预期见 [docs/test-matrix.md](docs/test-matrix.md)；e2e 的分组与踩坑见 [test/e2e/README.md](test/e2e/README.md)。

## 权威语料

`test/coverage/corpus/` 是可直接组合的 HTTP 包仓库与 case：

- `http/page/<id>.json`：页面自己发出的 EN 请求 + 默认 EN 响应，是问题上下文；
- `http/script/<id>.json`：脚本派生的 CN sheet、ClassJob、garland 响应，是答案侧数据；
- `cases/<slug>/questions.json`：该 case 实际生成的待处理元素；
- `cases/<slug>/manifest.json`：该 case 引用的 page/script 包 ID，以及 questions/expected 文件；
- `cases/<slug>/expected.json`：Vitest 调用生产函数算出的逐元素答案，只存答案；
- `manifest.json`：整轮捕获的 `captureId`、case 列表、全部包 ID、完整性与三份 digest。

HTTP 包使用同一 schema，`kind`/`origin` 为 `page` 或 `script`，`purpose` 区分 `sheet-en`、`sheet-cn`、`classjob`、`garland-search`、`garland-row`。包按请求 URL 去重，多个 case 可以引用同一个包；case manifest 决定该 case 实际调用哪些包。文件不保存 headers，只有 method/url/status/body。

expected 的 icon 答案只存最终 `alt`；生成阶段校验生产 `applyEntry` 写入的 `title` 与 `alt` 相同，不再重复保存一份 title。

`test/coverage/untranslated.allowlist.json` 是人工策略表，键为 `timeline:<en>` 或 `icon:<en>|<iconId>`（比较时 trim + lowercase），用于登记允许保持英文的量谱/UI 标记。普通 `test:unit` 离线读取 `manifest.json`、`http/`、`cases/`，检查每个待翻元素都有答案或命中 allowlist，不重新计算。

采集顺序不能颠倒：questions 采集 page 包与 case questions；responses 采集 script 包并把 case 引用写进 case manifest；expected 只消费这些包并生成 case expected。

旧的 labels/sheets/classjobs/abbreviations/garland/warnings/manifest 语料、`warnings.allowlist.json`、`test/coverage/coverage.spec.ts` 与 `test/e2e/live/corpus.spec.ts` 已删除。缺 `manifest.json`/`http`/`cases` 时新套件 skip；结构存在但内容坏会正常失败。

## 状态表烘焙

`src/data/generated/statuses.json` 是按 id 排序的 status 对照表，构建时由 `src/data/statuses.ts` 直接 import，Vite 内联进产物。**构建不联网**。源文件的 `rows` 每行一条、例外表保持缩进便于阅读；`vite.config.ts` 开启 `json.stringify` 并关闭 named exports，Vite 会把 JSON import 转成紧凑的 `JSON.parse("...")`，排版不进 bundle。

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
rushx update:data:corpus            # 先 status 烘焙，再 questions → responses → expected 全量刷新
rushx bake:statuses                 # 重新生成 status 数据（联网）
rushx bake:statuses:verify          # 离线校验 data 与 meta 的 hash/条目数/字段
rushx bake:statuses:check-upstream  # 只比较 meta 里的上游 commit
```

`bake:statuses` 默认跟随 `dawntrail` 分支，同时查上游源码与英文/国服 xivapi，并把实际 commit、国服版本、数据 hash 写进 `statuses.meta.json`；需要固定版本时用 `--sha <commit>`。生成文件要一起提交，`statuses.meta.json` 不参与打包。

告警直接输出到 stderr，不写入 meta；缺中文默认失败（`--allow-missing` 可放行），缺英文只告警并在记录中省略 `en`。数据源边界见 [docs/data-sources.md](docs/data-sources.md)。

## build

`rushx build`
