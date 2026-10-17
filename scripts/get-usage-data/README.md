# get-usage-data

从大模型服务商网页中保存用量数据的用户脚本。目前支持 DeepSeek 的用量页。

![TS100%](https://badgen.net/badge/TypeScript/100%25/3178C6?icon=typescript)

脚本不自己发请求，只在页面主世界旁听页面已经发出的用量接口响应，采集到之后由右下角的圆形按钮落盘成 JSON。

## 用法

打开 <https://platform.deepseek.com/usage>，右下角出现圆形按钮：

- 转圈：页面还没有请求过用量接口，等它自己发一次即可；
- 下载图标：已经采到数据，点一下落盘；
- 对勾：当前数据已经下载过。

按钮可以拖到任意位置，位置记在浏览器里，下次打开还在原处。按钮只在用量页出现。

## 覆盖范围

两类响应：`https://platform.deepseek.com/api/v0/usage/` 下的全部端点（含 `by_api_key/amount` 与 `by_api_key/cost`），以及账户概要 `https://platform.deepseek.com/api/v0/users/get_user_summary`。页面走 fetch 还是 XMLHttpRequest 都拦得到。

只收 2xx 且能解析成 JSON 的响应。同一个 URL 被反复请求（页面轮询）只留最新那条；换时间范围会改变查询串，各算一条。

## 落盘格式

文件名形如 `usage-deepseek-20261017-150405.json`，内容是采集到的记录数组：

```ts
interface Package {
  /** 完整的请求 URL，含查询串。 */
  requestUrl: string;
  /** 收到响应的时刻，ISO 8601 带本地时区偏移。 */
  responseTime: string;
  /** 响应体解析出来的 JSON。 */
  data: unknown;
}
```

## 运行

- `rushx build`：产出 `dist/`。图标在构建时取自 Iconify，需要联网。
- `rushx test`：vitest，离线跑假响应体，CI 门禁。
- `rushx lint` / `rushx format`：oxlint 与 oxfmt。
- `rushx typecheck`：`tsc -b`。
