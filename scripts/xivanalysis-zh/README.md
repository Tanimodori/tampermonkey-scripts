# xivanalysis-zh

Display actions and status of xivanalysis report in Chinese.

![TS100%](https://badgen.net/badge/TypeScript/100%25/3178C6?icon=typescript)

Install this scirpt at [GreasyFork](https://greasyfork.org/zh-CN/scripts/523443-xivanalysis-zh).

## develop

`pnpm i`

## test

`rushx test:unit`

Playwright e2e 按「页面来源 × 运行时」分四组：

- `rushx test:offline` —— 夹具页，快速注入 + 真管理器；页面与接口不出网。
- `rushx test:live:smoke` —— 一条真实战报 + 快速注入。
- `rushx test:live:all` —— 全部真实战报 + 快速注入，串行。
- `rushx test:tampermonkey` —— 一条真实战报 + 真 Tampermonkey。
- `rushx test:gate` —— unit + offline + live:smoke，日常构建门禁。
- `rushx test:all` —— 发布用完整集合，含 live:all 与 live:tampermonkey。

判什么、为什么这么分见 [test/e2e/README.md](test/e2e/README.md)。

## build

`pnpm run build`
