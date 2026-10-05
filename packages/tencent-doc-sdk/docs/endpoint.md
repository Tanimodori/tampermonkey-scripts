# Endpoint

`Endpoint` 描述单个 API 端点：调用名、两条校验槽与两个适配器。契约来自 `api-sdk-framework`，`context` 固定为本库的 client（`TDocClient`）。

```ts
export interface Endpoint<Context, In, Out> {
  /** 调用名，错误与报告用它点名这次调用 */
  readonly operation: string;
  /** 校验整份入参 */
  readonly requestSchema?: RequestSchema<In>;
  /** 校验投影后的出参 */
  readonly responseSchema?: ResponseSchema<Out>;
  /** 参数适配器，把调用方入参造成要发的请求 */
  readonly requestAdaptor: RequestAdaptor<Context, In, ApiRequest>;
  /** 返回值适配器，把到达的响应造成调用方所要的 `Out` */
  readonly responseAdaptor: ResponseAdaptor<Context, Out, ApiResponse>;
}
```

适配器都以 client 为上下文，从这里读地址、凭据与文档坐标；本库的端点是 `Endpoint<TDocClient, In, Out>`。

`requestAdaptor` 决定什么进路径、什么进查询串、什么进 body：载荷关键字包装（`{ getRecords: … }`）与两个授权的 `grant_type` 字面量都写在适配器里，调用方入参里没有它们。`responseAdaptor` 先用 `getEnvelope` 过传输级判定、`verifyEnvelope` 判业务码（裸答端点用 `getBareAnswer`），再从 `data` 读它那一段。

## 端点

- `getSheetList`（`getSheet`）：入参 `{ params?: { fileId? } }`，可整段省略；`GET /openapi/smartbook/v2/files/{fileId}/sheets`；读 `data.getSheet`。
- `getRecords`（`getRecords`）：入参 `{ offset, limit, params? }`；`POST /openapi/smartbook/v2/files/{fileId}/sheets/{sheetId}`，body `{ getRecords: { offset, limit } }`；读 `data.getRecords`。
- `addRecords`（`addRecords`）：入参 `{ records, params? }`；body `{ addRecords: { records } }`；读 `data.addRecords`。
- `updateRecords`（`updateRecords`）：入参 `{ records, params? }`，每行带 `recordID`；body 同构；读 `data.updateRecords`。
- `deleteRecords`（`deleteRecords`）：入参 `{ recordIDs, params? }`；答复只有信封头，投影为 `undefined`。
- `userinfo`（`userinfo`）：无入参；`GET /oauth/v2/userinfo`，`access_token` 在查询串上，不带自定义头；读 `data` 本身。
- `accessToken`（`accessToken`）：入参 `{ clientId, clientSecret, code, redirectUri }`；查询串为五个 snake_case 键，`grant_type=authorization_code`；裸 body 原样交回。
- `refreshToken`（`refreshToken`）：入参 `{ clientId, clientSecret, refreshToken }`；`grant_type=refresh_token`；裸 body 原样交回。

四个记录端点共享一个地址与一套三件套头；坐标默认取 `TDocClientOptions.params`，调用自带的 `params` 覆盖它，可以只报一半，另一半由配置补上。

## 官方参考

智能表：

- <https://docs.qq.com/open/document/app/openapi/v2/smartsheet/sheet/get_sheet.html>
- <https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/get_records.html>
- <https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/params.html>

OAuth：

- <https://docs.qq.com/open/document/app/oauth2/user_info.html>
- <https://docs.qq.com/open/document/app/oauth2/access_token.html>
- <https://docs.qq.com/open/document/app/oauth2/refresh_token.html>
