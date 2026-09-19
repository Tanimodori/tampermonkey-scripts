# 子表

一个腾讯文档可以包含多个智能子表，每个子表有自己的 `sheetID` 与标题。服务只使用配置好的那一个子表，但会在启动时向文档核对它确实存在——把 `fileID` 或 `sheetID` 写错应当是启动失败，而不是第一个请求的问题。记录读写见 [记录](record.md)。

## 端点一览

| 方法 | 路径                                           | 说明           |
| ---- | ---------------------------------------------- | -------------- |
| GET  | `/openapi/smartbook/v2/files/${fileID}/sheets` | 列出文档的子表 |

## 通用约定

- 地址是 `${apiBase}` 加路径，`${apiBase}` 的默认值与含义见 [配置：腾讯文档](../../config/docs.md)。
- 请求头带 `Accept: application/json`，以及凭据三元组 `Access-Token`、`Client-Id`、`Open-Id`。
- 响应是 `{ ret, msg, data }` 信封，内容位于以调用关键字命名的节里；信封的判定规则见 [与腾讯文档通讯](README.md)。

## 查询子表

接口定义：[查询子表](https://docs.qq.com/open/document/app/openapi/v2/smartsheet/sheet/get_sheet.html)

### 功能

- 列出文档包含的全部子表。
- 启动时用一次，把配置的 `sheetID` 与列表核对；此后不再调用。

### 参数

- 不接受查询参数与请求体。

### 正常返回值

`data.getSheet` 是数组，每个元素是 `Sheet`：`sheetID` 是子表编号，`title` 是标题，`isVisible` 表示是否可见，`type` 在智能表下是 `smartsheet`。

```json
{
  "ret": 0,
  "msg": "Succeed",
  "data": {
    "getSheet": [{ "sheetID": "tXXXXXX", "title": "智能表1", "isVisible": true, "type": "smartsheet" }]
  }
}
```

官方文档的示例把可见性字段拼作 `isVibile`，实际回答是 `isVisible`；服务按 `sheetID` 寻址，两种拼写都不读。

### 可能的报错

- `ERR_UPSTREAM_AUTH_FAILED`（503）：凭据对该文档没有权限（业务码 `10007`），或 token 被拒（`10302`、`10303`、`10313`、`37019`）。
- `ERR_UPSTREAM_RATE_LIMITED`（503）：上游按频率或按次数拒绝，响应带 `Retry-After` 头。
- `ERR_UPSTREAM_FAILED`（502）：上游 5xx、连不上、超时，或回答读不出业务码、`data` 里没有 `getSheet` 节。前三种会重试，后两种不重试。
- `ERR_CONFIG_INVALID`（500）：启动时配置的子表不在列表里，`message` 会列出文档实际的子表；服务不进入就绪状态。
