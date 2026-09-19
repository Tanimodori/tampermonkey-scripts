# 记录

记录是子表里的一行。一行由 `recordID` 标识，内容放在 `values` 里，以列名为键：本服务使用的五列是 `区服`、`地图`、`ID`、`北罐刷新时间`、`最后一次进岛时间`，列的含义与单元格的写法见 [表格数据](../../data/pot.md)。

四个操作共用同一个地址与同一个动词，只换请求体里的关键字。一页至多返回 100 行，是否继续翻页由调用方决定。

## 端点一览

| 方法 | 路径                                                      | 关键字          | 说明               |
| ---- | --------------------------------------------------------- | --------------- | ------------------ |
| POST | `/openapi/smartbook/v2/files/${fileID}/sheets/${sheetID}` | `getRecords`    | 读一页行           |
| POST | 同上                                                      | `addRecords`    | 追加行             |
| POST | 同上                                                      | `updateRecords` | 按 `recordID` 改写 |
| POST | 同上                                                      | `deleteRecords` | 按 `recordID` 删除 |

## 通用约定

- 地址是 `${apiBase}` 加路径，`${apiBase}` 的默认值与含义见 [配置：腾讯文档](../../config/docs.md)。
- 请求头带 `Content-Type: application/json`、`Accept: application/json`，以及凭据三元组 `Access-Token`、`Client-Id`、`Open-Id`。
- 请求体与响应都是单层包装：请求是 `{ "关键字": … }`，响应位于 `data.关键字`。
- 写入文本列必须使用带类型的单元格（`[{ "type": "text", "text": "鸟" }]`）；裸字符串会被静默丢弃并回答成功，见 [表格数据](../../data/pot.md)。
- 回答除本服务读取的字段外还带作者与修改人列，以及 `autoRawRecords`、`newAutoRawRecords`，一律原样保留。
- 四个操作共用同一套报错：`ERR_UPSTREAM_BAD_REQUEST`（400）参数或列名被拒；`ERR_UPSTREAM_AUTH_FAILED`（503）凭据或权限被拒；`ERR_UPSTREAM_RATE_LIMITED`（503）被上游限流，响应带 `Retry-After` 头；`ERR_UPSTREAM_FAILED`（502）上游 5xx、连不上、超时（会重试），或回答读不出业务码、缺少对应的节（不重试）。消息模板与完整对照见 [错误处理](../errors.md)。

## 查询记录

接口定义：[查询记录](https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/get_records.html)

### 功能

- 按 `offset`/`limit` 读一页行，顺序是表里的顺序。
- 读完一页是否再读下一页由调用方决定；本服务读到的是配置子表的全部行。

### 参数

- `offset`（数字）：起始行号，从 0 开始。
- `limit`（数字）：本页行数，上限 100。

```json
{ "getRecords": { "offset": 0, "limit": 100 } }
```

### 正常返回值

`data.getRecords` 是 `CommonRecords`：`records` 是 `CommonRecord` 数组（`recordID`、`values`，以及文档自己的 `createTime`/`updateTime`，以 13 位毫秒字符串返回），`total` 是表内行数，`hasMore` 表示是否还有后续页，`next` 是下一页的 `offset`。空表是一页空的 `records` 与 `0` 的 `total`。

```json
{
  "ret": 0,
  "msg": "Succeed",
  "data": {
    "getRecords": {
      "records": [
        {
          "recordID": "r00001",
          "createTime": "1789100000000",
          "updateTime": "1789199000000",
          "values": { "区服": [{ "type": "text", "text": "鸟" }] }
        }
      ],
      "total": 1,
      "hasMore": false,
      "next": 1
    }
  }
}
```

### 可能的报错

见 [通用约定](#通用约定)。

## 新增记录

接口定义：[记录接口参数](https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/params.html)

### 功能

- 按给定顺序追加行。
- 本服务一次只追加一行（一个罐子）。

### 参数

- `records`（数组）：每个元素是一行的 `values`，以列名为键。

```json
{ "addRecords": { "records": [{ "values": { "区服": [{ "type": "text", "text": "鸟" }] } }] } }
```

### 正常返回值

`data.addRecords.records` 是被写入的行，只有 `recordID` 与 `values`：新增与更新都不回传时间戳，行的时刻要等下一次读取才拿得到。回答没有给出 `recordID` 时，该罐子被缓存为没有文档侧记录，并记一条日志。

```json
{
  "ret": 0,
  "msg": "Succeed",
  "data": { "addRecords": { "records": [{ "recordID": "rNew1", "values": { "区服": [{ "type": "text", "text": "鸟" }] } }] } }
}
```

### 可能的报错

见 [通用约定](#通用约定)。写入被拒绝时，表、缓存与该行的文档侧记录都不变。

## 更新记录

接口定义：[记录接口参数](https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/params.html)

### 功能

- 按 `recordID` 定位行，整格替换 `values`。
- 本服务只更新它已经认得的那一行：同一个 `区服|地图|ID` 命中多行时改最后一次进岛最新的一行，其余行在写入成功后删除。

### 参数

- `records`（数组）：每个元素是 `{ recordID, values }`。

```json
{ "updateRecords": { "records": [{ "recordID": "r00001", "values": { "区服": [{ "type": "text", "text": "猫" }] } }] } }
```

### 正常返回值

`data.updateRecords.records` 是被改写的行，形状与新增一致：`recordID` 与 `values`，不带时间戳。

### 可能的报错

见 [通用约定](#通用约定)。更新被拒绝时，表与缓存都不变。

## 删除记录

接口定义：[记录接口参数](https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/params.html)

### 功能

- 按 `recordID` 删除行。
- 本服务用它清理不该再被看到的行：最后一次进岛早于 `OPS_UPSTREAM_STALE_AFTER_MS` 的行，以及不构成合法罐子的行；同键的重复行在写入成功后删除。
- 删除失败不影响本次读写，只记一条日志，留到下一次再试。

### 参数

- `recordIDs`（字符串数组）：要删除的行标识。

```json
{ "deleteRecords": { "recordIDs": ["r00001", "r00002"] } }
```

### 正常返回值

只有信封头 `{ ret, msg }`，没有 `data`。

```json
{ "ret": 0, "msg": "Succeed" }
```

### 可能的报错

见 [通用约定](#通用约定)。删除失败不改变读写结果，被删不掉的行留到下一次清理。
