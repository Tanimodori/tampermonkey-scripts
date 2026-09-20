# 消费方探针

以兄弟包的身份,通过 `package.json#exports` 按子路径导入**构建产物**,并用 `skipLibCheck: false` 检查其声明。

```bash
rushx build && tsc -p probe/tsconfig.json
```

检查的是两件在包内测试里测不到的事:`./plugin` 与 `./load` 的声明能被外部解析(相对路径、`export {}` 的形状、以及它们引到的 `xiv-api-provider` 类型),以及那份 `*.csv` 通配声明真的能匹配上 `xiv-datamine-polyfill/<Sheet>.csv` —— 探针里同时导了一张没在声明里列出的表,通配若失效会立刻报错。

类型引用与真实消费者的写法不同:探针由 `tsconfig` 直接包含 `../client.d.ts`,因为 TS 解析 `/// <reference types="包名/子路径" />` 要走 `node_modules`,而一个包不在自己的 `node_modules` 里。差异记录在 [插件的设计](../docs/design.md) 的当前限制一节。
