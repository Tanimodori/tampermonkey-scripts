# xivanalysis-zh

Display actions and status of xivanalysis report in Chinese.

![TS100%](https://badgen.net/badge/TypeScript/100%25/3178C6?icon=typescript)

Install this scirpt at [GreasyFork](https://greasyfork.org/zh-CN/scripts/523443-xivanalysis-zh).

## develop

`pnpm i`

## test

`pnpm run test`

另有两组 Playwright e2e：注入组用 `addInitScript` 在 document-start 注入产物并假扮 `GM`（离线、可进 CI），真管理器组把产物装进真的 Tampermonkey 里跑（要网络、慢）。`rushx test:e2e` / `rushx test:e2e:tampermonkey` / `rushx test:e2e:all`，判什么、为什么这么分见 [test/e2e/README.md](test/e2e/README.md)。

## build

`pnpm run build`
