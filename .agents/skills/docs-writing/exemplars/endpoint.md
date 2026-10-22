<!--
范本：端点表。只写调用方要发的请求与能收到的答复。
响应信封只在开头说明一次，逐端点的返回值只写 data 的形状。
错误码与状态码对照归统一错误处理，不在这里重复。
正文中的路径、字段与示例值都是占位，按实际端点替换。
-->

# API 端点

所有答复共用同一信封。

## 端点一览

| 方法 | 路径            | 说明     |
| ---- | --------------- | -------- |
| GET  | `/api/v1/items` | 一句说明 |
| POST | `/api/v1/items` | 一句说明 |

## 通用约定

- 参数类型：…
- 时间与数值：…
- 字段命名：…

## GET /api/v1/items

### 功能

- 一句结论。
- 一句边界。

### 参数

- 不接受参数。

### 正常返回值

```ts
type ListItemsResponse = Item[];

interface Item {
  /** 条目 ID */
  id: string;
  /** 条目的值 */
  value: string;
}
```

## POST /api/v1/items

### 功能

- 一句结论。
- 一句边界。

### 参数

```ts
interface AddItemRequest {
  /** 条目 ID */
  id: string;
  /** 条目的值 */
  value: string;
  /** 附加字段 */
  extra?: {
    /** 标签 */
    tags: readonly string[];
  };
}
```

### 正常返回值

```ts
interface AddItemResponse {
  /** 条目 ID */
  id: string;
}
```
