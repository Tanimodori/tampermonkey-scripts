# 测试矩阵

本文描述重组后的目标结构，脚本与目录按迁移顺序落地。测试按拦截、UI、安装、上游、权威拆分，全链路 smoke 是唯一跨维度的用例。

## 维度说明

| 维度 | 回答的问题                                         | 形态                                               | 不测什么                   |
| ---- | -------------------------------------------------- | -------------------------------------------------- | -------------------------- |
| 拦截 | 目标请求能否被识别、改写、合并、降级               | 纯函数单元测试                                     | 不启动浏览器，不碰 DOM     |
| UI   | 目标节点能否被找到、读出、改对                     | jsdom 测试                                         | 不发网络请求，不测安装     |
| 安装 | 产物能否在快速注入和真管理器里跑起来               | Playwright 离线夹具                                | 不测翻译细节               |
| 上游 | 真实英文、国服、ClassJob、garland 能否返回可用数据 | live 契约测试                                      | 不打开战报页，不跑全量战报 |
| 权威 | 真实战报上出现的待翻内容是否都有译文               | questions + responses + Vitest expected + 离线覆盖 | 不重复测拦截、UI、安装     |

形态列是维度层面的概括，逐条用例的类型以各矩阵的类型列为准。live 指访问真实站点与接口，夹具指 Playwright 的离线页面与路由桩。

全链路 smoke 不属于第六个维度，只跨安装、上游、拦截、UI。

## 测试类型

- 单元测试：不启动浏览器，默认网络用桩；标为契约的用例访问真实端点。
- DOM测试（jsdom）：在 jsdom 中验证节点探测与改写。
- playwright快速注入测试：用 `addInitScript` 在真实浏览器注入产物；上游契约例外，不注入产物，只借浏览器验证跨域。
- playwright完整注入测试：用真 Tampermonkey 安装产物。

门禁按维度划分。`test:gate:offline` 运行拦截、UI、安装与权威的离线用例。`test:gate:live` 运行上游契约与全链路 smoke。

## 拦截

| 维度 | 名称 | 内容 | 类型 | 预期 |
| --- | --- | --- | --- | --- |
| 拦截 | URL 识别 | `Action`、`Item`、`Status`、`Addon`、`Trait` 这些 sheet，`Addon` 名称字段为 `Text`，`host` 白名单含 beta 与子域，只认 `language=en` | 单元测试 | 命中返回 `kind`、`nameField`、`cnUrl`，其余返回 `null` |
| 拦截 | 地址改写 | `host` 换成 `xivapi-v2.xivcdn.com`，`language` 换成 `chs`，其余查询参数保留 | 单元测试 | `fields`、`limit` 等参数逐项不变 |
| 拦截 | 行合并 | 按 `row_id` 配对，替换 `fields` 与 `transient`，未配对的英文行不动 | 单元测试 | 命中行是中文，未命中行保持英文 |
| 拦截 | 职业缩写 | `ClassJob.Abbreviation` 换成中文全名，未知缩写与缺字段 | 单元测试 | `AST` 变占星术士，未知保持原样 |
| 拦截 | 降级分支 | 英文成功加国服失败、英文失败加国服成功、两边都失败、坏 `JSON` | 单元测试 | 分别原样返回英文、改用国服响应并返回 200、交回原错误 |
| 拦截 | 透传与请求头 | 非目标请求原样透传，英文请求保留原 `init`，国服请求带 `accept` | 单元测试 | `input`、`init` 不丢，国服请求头正确 |
| 拦截 | GM 传输 | `GM` 响应包装成 `Response`，失败与超时 reject | 单元测试 | 状态、正文、响应头形状正确 |

## UI

| 维度 | 名称              | 内容                                                                  | 类型             | 预期                               |
| ---- | ----------------- | --------------------------------------------------------------------- | ---------------- | ---------------------------------- |
| UI   | 时间轴替换        | 目标单元格的英文标签                                                  | DOM测试（jsdom） | `textContent` 变成中文             |
| UI   | 时间轴跳过        | `grid-column-start` 为 `-3` 的列、含中日韩、单字母、已登记            | DOM测试（jsdom） | 文本全部不变                       |
| UI   | 时间轴动态与补扫  | 后加节点、`body` 晚到、映射增长触发重扫                               | DOM测试（jsdom） | 新节点也被替换                     |
| UI   | 图标替换与 iconId | `alt` 变 `alt` 和 `title`，从 `src` 解析 `iconId` 并传入查询          | DOM测试（jsdom） | 两个属性都更新，解析收到 `iconId`  |
| UI   | 图标跳过与移除    | 空 `alt`、含中日韩 `alt`、坏 `src`、解析返回前节点被移除              | DOM测试（jsdom） | 不调用回调或保持原样               |
| UI   | 写入方式优先级    | `modifier` 优先，否则 `img` 写 `alt` 与 `title`，其他写 `textContent` | DOM测试（jsdom） | 每种写入方式各自正确               |
| UI   | 样式注入          | `head` 尚未出现时调用，稍后出现                                       | DOM测试（jsdom） | `style` 最终进入 `head` 且包含 CSS |
| UI   | tooltip 轮换      | 点击 `span.alternative`，`--display-nth` 循环                         | DOM测试（jsdom） | 显示项按顺序轮换                   |
| UI   | 未命中不改        | 解析返回空数组                                                        | DOM测试（jsdom） | 节点保持原文                       |
| UI   | 告警去重          | 同一英文串多次上报                                                    | 单元测试         | 只 `console.warn` 一次             |

## 安装

| 维度 | 名称        | 内容                                         | 类型                   | 预期                                              |
| ---- | ----------- | -------------------------------------------- | ---------------------- | ------------------------------------------------- |
| 安装 | 元数据      | `@match`、`@grant`、`@connect`、`@run-at`    | 单元测试               | 与预期值一致                                      |
| 安装 | 快速注入    | `addInitScript` 在 `document-start` 注入产物 | playwright快速注入测试 | 无 `pageerror`，`fetch` 被接管，`style` 在 `head` |
| 安装 | 完整注入    | 真 Tampermonkey 安装后打开匹配页             | playwright完整注入测试 | 脚本注入，`fetch` 被接管                          |
| 安装 | @match 之外 | 打开非匹配站点                               | playwright完整注入测试 | `fetch` 仍是原生函数                              |

## 上游

| 维度 | 名称 | 内容 | 类型 | 预期 |
| --- | --- | --- | --- | --- |
| 上游 | garland 适配 | 检索 URL、精确同名、取 `obj.i` 和 `kind`、国服单行读、同串缓存、失败降级 | 单元测试 | 参数与降级路径正确 |
| 上游 | 英文 sheet 契约 | 真实 `v2.xivapi.com` 的 `Action` 表 | playwright快速注入测试 | 200，`rows` 非空，含 `Name` 与 `Icon.id` |
| 上游 | 国服 sheet 契约 | 真实 `xivapi-v2.xivcdn.com` 的 `Action` 表与跨域 | playwright快速注入测试 | 200，`rows` 非空，含 `Name` |
| 上游 | ClassJob 契约 | 真实国服 `ClassJob` 表 | playwright快速注入测试 | `AST` 能对应到中文全名 |
| 上游 | garland 契约 | 真实 `search.php` | 单元测试 | 200，命中含 `obj.i` 与 `obj.n` |

上游契约不注入产物。用 Playwright 只验证浏览器的跨域行为。

garland 没有 ACAO，走 Node `fetch` 验证形状。

上游契约统一由 `test:live:upstream` 运行，属于 `test:gate:live`。

## 权威

| 维度 | 名称 | 内容 | 类型 | 预期 |
| --- | --- | --- | --- | --- |
| 权威 | 问题完整性 | 无脚本页面的请求、默认 EN 响应、待处理元素 | Playwright 采集 + 单元测试 | 页/元素/请求非空，默认响应 2xx 且 rows 覆盖请求 row_id |
| 权威 | 独立响应 | CN sheet、ClassJob、garland 由生产 URL 派生并保存完整 body | Vitest 采集 + 单元测试 | 每个 sheet 请求都有 CN 响应，EN/CN row_id 配对完整，ClassJob 存在 |
| 权威 | expected 覆盖 | Vitest 调用生产函数计算逐元素答案 | Vitest 计算 | 每个待翻元素有答案或 allowlist；答案不是残留英文；失败不写文件 |
| 权威 | 离线答案 | case expected 与根 manifest 的 digest、页/数组对齐 | 单元测试 | digest 一致，null 只对应跳过/allowlist，allowlist 双向一致 |
| 权威 | sheet 类型受支持 | questions 中实际出现的 sheet 类型 | 单元测试 | 全部走生产 `parseSheetRequest`，CN URL 可派生 |
| 权威 | 表行名称覆盖 | EN 默认响应与 CN 响应的同名 row_id | 单元测试 | 每个 EN 行有 CN 行，缺失/多余逐条报出 |
| 权威 | 职业缩写覆盖 | ClassJob 响应全表与 `JOBS` fixture；Action 行若带缩写也检查 | 单元测试 | 至少 44 行，21 个战斗职业都有中文全名，缩写/全名非空且不同 |
| 权威 | 未翻译策略 | `untranslated.allowlist.json` 的 queryKey | 单元测试 | 未译文必须登记，登记项不得过期，理由非空 |
| 权威 | override 完整性 | 每条 `override` 有 `zh` 或 `modifier`，`en` 不重复 | 单元测试 | 0 异常 |
| 权威 | 烘焙表完整性 | `hash`、条目数、`formatVersion`、id 唯一且升序、元组行与稀疏例外（`enNames`/`enIcons`/`zhIcons`）、大小写匹配、名称优先与三方图标消歧 | 单元测试 | 与烘焙表元数据一致；meta 不再含 warnings/diagnostics/counts |

权威用例读 `test/coverage/corpus/` 的根 `manifest.json`、`http/<kind>/<id>.json` 与 `cases/<slug>/`。HTTP 包统一为 page/script 两种 origin：page 包含无脚本页面实际发出的请求、默认 EN 响应；script 包含独立采集脚本派生的 CN/ClassJob/garland 完整响应。case manifest 引用该 case 需要的 page/script 包，questions 存元素，expected 存 Vitest 调用生产函数算出的逐元素答案。普通 `test:unit` 离线读这些文件做覆盖检查，不重新调用 resolve；答案阶段本身通过 `test:corpus:expected` 执行，覆盖判据不通过时不写 expected。旧 labels/sheets/classjobs/abbreviations/garland/warnings/manifest 语料、`warnings.allowlist.json`、`test/coverage/coverage.spec.ts` 与 `test/e2e/live/corpus.spec.ts` 已删除。

`statuses.json` 的 `id` 是游戏 `Status` 表 row_id，不是 FFLogs 的 `+1,000,000` ID。数据用 `rows` 元组保存 `[id, upstream 名, upstream 图标, 国服名]`；`enNames`/`enIcons` 只存与 upstream 不同的例外，`zhIcons` 只存与当前 en/upstream 图标不同的例外。源文件的 `rows` 每行一条，Vite 构建时转成紧凑的 `JSON.parse`。运行时页面没有 row_id，先按 upstream name、再按 en name 匹配，同名多 id 时用 upstream/en/zh 图标消歧。烘焙告警只写 stderr，不进入 meta。数据源与采集边界见 [data-sources.md](data-sources.md)。

## 全链路 smoke

| 维度 | 名称 | 内容 | 类型 | 预期 |
| --- | --- | --- | --- | --- |
| 安装、上游、拦截、UI | 真实战报 smoke | 一条真实战报加快速注入 | playwright快速注入测试 | `fetch` 被接管，至少一次国服 sheet 返回 200，样式在页面，时间轴出现中文 |

## 测试脚本

| 脚本                    | 内容                                      | 何时运行                        | 估算成本              |
| ----------------------- | ----------------------------------------- | ------------------------------- | --------------------- |
| `test:unit`             | vitest 运行 unit、dom、coverage           | 每次离线门禁                    | 1–2 秒                |
| `test:e2e:fast`         | 构建后跑离线快速注入组                    | 每次离线门禁                    | 约 5 秒               |
| `test:e2e:full`         | 构建后跑离线真 Tampermonkey 组            | 每次离线门禁                    | 约 30 秒              |
| `test:live:upstream`    | 上游契约全部用例                          | 在线门禁                        | 约 5 秒               |
| `test:live:smoke`       | 真实战报 smoke                            | 在线门禁                        | 约 15–60 秒           |
| `test:corpus:capture`   | questions → responses → expected 全量刷新 | 手工刷新语料                    | 约 50 分钟 + 接口请求 |
| `test:corpus:questions` | 只采集无脚本问题                          | 手工刷新问题                    | 约 50 分钟            |
| `test:corpus:responses` | 只采集独立响应                            | questions 更新后                | 约数分钟              |
| `test:corpus:expected`  | 只重算逐元素答案                          | responses 或生产逻辑更新后      | 1–2 秒                |
| `test:gate:offline`     | 离线部分的所有测试                        | 本地提交前；CI 只跑 `test:unit` | 约 40 秒              |
| `test:gate:live`        | 在线部分的所有测试                        | 发布前或手动                    | 约 1 分钟             |

离线组只保证页面与接口不出网。真 Tampermonkey 组首次运行仍需下载扩展。

`test:corpus:capture` 是语料刷新步骤，不属于两个门禁。

两个门禁合起来是全部测试。
