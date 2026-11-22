# Changelog

## Unreleased

- `statuses.json` 改为按 id 排序的元组 + 稀疏例外（`rows` + `enNames`/`enIcons`/`zhIcons`）；运行时按 upstream/en 名称匹配，并用三方图标消歧。
- 源文件 `rows` 每行一条、例外表保持缩进；`vite.config.ts` 统一把 JSON import 转成紧凑的 `JSON.parse`，构建产物 59.9 kB，低于改动前的约 72.9 kB。
- `statuses.meta.json` 精简为 `formatVersion`、upstream、国服版本和 data hash/条目数；移除 diagnostics、warnings、counts。
- 移除 `bake:statuses:check-icons`、`update:data:icons`；烘焙 warning 改为输出到 stderr。
- 权威语料改为统一 HTTP 包仓库：`http/page/<id>.json` 存无脚本页面的 EN 请求与默认响应，`http/script/<id>.json` 存 CN/ClassJob/garland 响应；每个包使用同一 schema，按 `kind`/`origin` 区分 page/script，按请求 URL 去重。
- `cases/<slug>/manifest.json` 用包 ID 重新组合该 case 的 page/script 包；`questions.json` 存元素，`expected.json` 存 Vitest 调用生产函数算出的逐元素答案；根 `manifest.json` 记录 captureId、case/包清单与 digest。
- expected 的 icon 答案只保存最终 `alt`；约定生产 `applyEntry` 的 `title === alt`，生成阶段校验该约定，不再重复保存 title。
- case slug 使用 `reportCode__fightId__actorId`，例如 `mn7bYWMQf9vhABrG__4__3`；不加序号前缀，顺序由根 manifest 维护。
- 新增 `test:corpus:questions`、`test:corpus:responses`、`test:corpus:expected`；`test:corpus:capture` 依次执行三步。
- 删除旧 labels/sheets/classjobs/abbreviations/garland/warnings/manifest 语料、`warnings.allowlist.json`、旧 `coverage.spec.ts` 与 `live/corpus.spec.ts`，由 `http/` + `cases/` + 根 manifest 和 `untranslated.allowlist.json` 取代。
- 新增 `untranslated.allowlist.json`，按 `timeline:<en>` / `icon:<en>|<iconId>` 登记允许保持英文的条目。

## v0.0.6 (2026/10/21)

- 构建期烘焙 xivanalysis 状态表（英文名/icon + 国服简中名），时间轴与图标不再为状态名逐个反查。
- 新增 `rushx bake:statuses` 更新烘焙数据；`build` 仍完全离线。

## v0.0.5 (2026/9/24)

- 中文翻译改用国服 xivapi 数据源，数据更新更及时。
- 修复了跨源请求被浏览器拦截，导致时间轴、图标等部分内容无法翻译的问题。

## v0.0.4 (2025/7/20)

- 修复了时间轴中黑魔「星极火和灵极冰」一栏未翻译的问题。

## v0.0.3 (2025/2/6)

- 修复了 xivanalysis 使用新版 xivapi 接口导致的问题。（[xivanalysis#ad2bd3a](https://github.com/xivanalysis/xivanalysis/commit/ad2bd3a9bdfcbe5bb5e5a185aee7e0618c616978)）
- 移除了对 garlandtools.org 国际服数据站的依赖。

## v0.0.2 (2025/1/15)

- 修复了时间轴里部分文本未翻译和翻译错误的问题。

## v0.0.1 (2025/1/11)

- 初版发布。
