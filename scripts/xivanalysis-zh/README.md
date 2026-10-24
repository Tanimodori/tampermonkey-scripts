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
rushx bake:statuses                 # 更新数据（唯一联网步骤）
rushx bake:statuses:verify          # 离线校验 data 与 meta 的 hash/条目数/字段
rushx bake:statuses:check-upstream  # 只比较 meta 里的上游 commit
```

`bake:statuses` 默认跟随 `dawntrail` 分支并把实际 commit 写进 `statuses.meta.json`；需要固定版本时用 `--sha <commit>`。生成文件要一起提交，`statuses.meta.json` 不参与打包。

## build

`rushx build`
