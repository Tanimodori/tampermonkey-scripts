# 校验

schema 全部集中在 `endpoints/schema.ts`：线上契约（响应、信封头、JWT 段）与八个端点的入参都在那里定义，其余模块只从它取值或取类型。

## 入参严格，响应宽松

- 入参 schema 守在配额之前：范围、字符串长度、空列表、未声明键的剥除都发生在入参被 `parse` 的那一刻，拒掉一个上游会答 `请求参数错误`（或更糟，安静问错行）的调用。
- 响应 schema 不剥键：文档里没人读的列（`creatorName`、`autoRawRecords`）原样保留给要看第二眼的人；上游自己的松弛（文本单元格的几种形状、`isVisible` 与文档示例的 `isVibile` 两种拼写）都接受。
- 请求的坐标覆盖是局部形状：调用可以只报一半，与 client 的坐标合并后按端点自己的完整坐标校验，多出来的键在整对校验时被剥掉（`resolveCoordinates`）。
- 端点收下的入参里没有线上形状：关键字包装与位置分配由适配器完成，见 [endpoint](endpoint.md)。

## 校验发生在两处

- 入参：调用链第一步，`requestSchema?.parse` 不过即 `BAD_INPUT`，字段路径按调用方形状走（`offset`，不是 `getRecords.offset`）；坐标校验不过同样是 `BAD_INPUT`。
- 出参：适配器投影之后，`responseSchema?.parse` 不过即 `BAD_OUTPUT`；投影自己抛出的（比如答复里没有 `data`）同样归 `BAD_OUTPUT`。
- 信封头由判定自己读，不经过端点的 schema：读不出就当没有业务码，信封契约下报 `BAD_OUTPUT`，裸答契约下交给调用方，见 [错误处理](error.md)。
