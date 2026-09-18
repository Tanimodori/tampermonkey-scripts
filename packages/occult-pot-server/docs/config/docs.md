# 腾讯文档

文档坐标与访问凭据。文档与子表的含义见 [与腾讯文档通讯](../api/upstream.md)，测试文档的获取方式见 [本地开发](../development.md)。

标着必填的四项没有默认值：缺任意一项，服务在启动时就拒绝运行。

## OPS_DOCS_API_BASE

- 类型：`URL`
- 默认值：`https://docs.qq.com`
- 接口的 origin。只取 origin，配了路径或查询串会被丢掉。`.env.development` 把它指向本地 mock，开发与单元测试因此不会碰真实 API。

## OPS_DOCS_FILE_ID

- 类型：`字符串`（腾讯文档 API 的 `fileID`）
- 默认值：`无（必填）`
- 形如 `300000000$ExAmPlEfIlEiD`，是 API 的文档编号，不是浏览器地址栏里的表格链接。compose 以 `format: raw` 读值文件，`$` 会原样传入。

## OPS_DOCS_SHEET_ID

- 类型：`字符串`（子表 `sheetID`）
- 默认值：`无（必填）`
- 记录所在的子表。分享链接里的 `tab=` 就是它，`viewId` 不属于记录接口。

## OPS_DOCS_CLIENT_ID

- 类型：`字符串`
- 默认值：`无（必填）`
- 腾讯文档开放平台上这个应用的 Client-Id。

## OPS_DOCS_ACCESS_TOKEN

- 类型：`字符串`（JWT）
- 默认值：`无（必填）`
- 授权本服务的 Access Token，有效期 30 天，自带 `sub`（Open-Id）与 `exp` 声明，所以通常不必再写 `OPS_DOCS_OPEN_ID`。

## OPS_DOCS_CLIENT_SECRET

- 类型：`字符串`
- 默认值：`无`
- 只有刷新 token 才需要，来自一次性的授权码流程。当前没有定时调度，刷新要靠人工触发。

## OPS_DOCS_REFRESH_TOKEN

- 类型：`字符串`
- 默认值：`无`
- 刷新 token 用，有效期一年。与 `OPS_DOCS_CLIENT_SECRET` 缺任意一个都会拒绝刷新。

## OPS_DOCS_OPEN_ID

- 类型：`字符串`
- 默认值：``无（省略时取自 token 的 `sub` 声明）``
- 调用 Open API 时要带的 Open-Id。配了就以配置为准：它和 token 不匹配时启动就会失败，而不是等到第一次调用。

## OPS_DOCS_TOKEN_EXPIRY_WARN_MS

- 类型：`时长（毫秒）`
- 默认值：`259200000`（3 天）
- 提前多久提醒凭据快过期：进入这个窗口后记一条 warning，就绪状态从这时起算 degraded。
