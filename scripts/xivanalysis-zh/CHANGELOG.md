# Changelog

## Unreleased

- `statuses.json` 改为按 id 排序的元组 + 稀疏例外（`rows` + `enNames`/`enIcons`/`zhIcons`）；运行时按 upstream/en 名称匹配，并用三方图标消歧。
- 源文件保持可读缩进；`vite.config.ts` 统一把 JSON import 转成紧凑的 `JSON.parse`，构建产物 59.9 kB，低于改动前的约 72.9 kB。
- `statuses.meta.json` 精简为 `formatVersion`、upstream、国服版本和 data hash/条目数；移除 diagnostics、warnings、counts。
- 移除 `bake:statuses:check-icons`、`update:data:icons`；烘焙 warning 改为输出到 stderr。

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
