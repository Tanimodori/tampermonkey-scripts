# 数据源与采集边界

本仓库有三条相关链路；xivanalysis-zh 自己使用前两条（浏览器语料与 status 烘焙），datamining 是仓库里的另一条管线，用来对照“权威游戏表”与“页面事实”的边界。它们采集的事实不同，不能互相替代。

## 三条链路

| 链路 | 采集什么 | 触发 | 产物 | 是否提交 |
| --- | --- | --- | --- | --- |
| 浏览器语料 | 真实战报页的终态、接口响应、`[xiv-warn]` | `rushx test:corpus:capture`（Playwright，约 50 分钟） | `test/coverage/corpus/*.json` | 提交 |
| status 烘焙 | 上游 xivanalysis `STATUSES` + 英文/国服 xivapi `Status`（按 id 合并） | `rushx bake:statuses`（Node，联网） | `src/data/generated/statuses.json` 与 meta | 提交 |
| datamining | 权威游戏表 CSV（`InfSein/ffxiv-datamining-mixed`） | 构建时按需拉取 | `node_modules/.cache/...` | 不提交 |

## 为什么不合并

- 浏览器语料记录的是“xivanalysis 页面实际显示了什么”，包括站点自己的 UI 字符串、时间轴终态、脚本改写结果和未命中告警。datamining 没有这些信息，无法替代。
- datamining 的 CHS 数据有滞后。2026-10 时 `chs/Status.csv` 的最新提交是 2026-09-08（CHS 7.56，数据 2026.09.01），而 xivapi 国服当时是 `20261013-1e14140`。status 烘焙继续用 xivapi 国服作为主源；datamining 只适合做可选交叉校验或离线兜底。
- status 烘焙还需要上游 xivanalysis 的 `STATUSES` TS 源码；那是人工整理、带 layer/patch 覆盖的清单，不是游戏表，datamining 不能替代。
- 两边的路径也不同：浏览器语料是提交到仓库的快照，datamining 是构建缓存。把两者放进同一个目录会把“历史事实”和“可重建缓存”混在一起。

## 哪些可以统一

- 入口：`rushx update:data` 只跑 status 烘焙；语料 capture 是单独的约 50 分钟手工步骤，默认不跑，显式加 `--corpus` 才跑。
- 底层工具：原子写、内容 hash、缓存与重试。datamining 侧是内容寻址缓存（`xiv-datamine-polyfill`），status 烘焙是按上游 commit 缓存；语义不同，暂不抽共享包，等第三个消费者出现再考虑。
- id 对照表：status 烘焙以游戏 `Status` row_id 为主键，把上游 `STATUSES`、英文 xivapi、国服 xivapi 合并成 `rows` 元组；en 名、en 图标只在与 upstream 不同时写入例外表，国服图标只在不同于当前 en 图标（没有 en 时 upstream）时写入 `zhIcons`。页面 DOM 没有 row_id，运行时仍按页面可见的英文名 + 图标匹配；id 用于数据合并与校验，同名消歧仍靠图标。

## universalis-zh-data

`scripts/universalis-zh-data` 的两份 CSV 是手工提交的 datamining 表副本，本身没有采集/生成步骤。如果要做“统一采集”，更合适的方向是把这个包改成构建期从 datamining 取数，而不是改 xivanalysis-zh 的浏览器语料。
