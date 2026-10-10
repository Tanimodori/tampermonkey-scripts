# Endpoint

`Endpoint` 描述单个 API 端点，由调用名、两条校验槽与两个适配器构成。契约来自 `api-sdk-framework`，`context` 固定为本库的 client，因此本库的端点是 `Endpoint<TDocClient, In, Out>`，包内以 `TDocEndpoint<In, Out>` 指代它。

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

`requestAdaptor` 把入参造成 `ApiRequest`，`responseAdaptor` 判定答复并投影成 `Out`。两者都以 client 为上下文，从这里读地址、凭据与文档坐标，关键字包装、位置分配与业务码判定都在适配器里，调用方入参里没有它们。

## 端点

本库翻译八个端点，都在 `endpoints` 上按调用名可取，也有同名的具名导出。入参是调用方形状，类型名与调用同名加 `Input`。

### 记录

四个调用共址同动词，`POST /openapi/smartbook/v2/files/{fileId}/sheets/{sheetId}`。body 的关键字与答复的分段都是调用名，四个调用因此只有载荷不同，且都带三件套头。

- `getRecords`（`GetRecordsInput`）：`{ offset, limit, params? }`，答 `CommonRecords`。
- `addRecords`（`AddRecordsInput`）：`{ records, params? }`，答 `WrittenRecords`。
- `updateRecords`（`UpdateRecordsInput`）：`{ records, params? }`，每行多一个 `recordID`，答 `WrittenRecords`。
- `deleteRecords`（`DeleteRecordsInput`）：`{ recordIDs, params? }`，答复只有信封头，投影为 `undefined`。

### 子表

- `getSheetList`（`SheetListInput`，`operation: 'getSheet'`）：`GET /openapi/smartbook/v2/files/{fileId}/sheets`，入参 `{ params? }` 只含 `fileId`，可整段省略，答 `Sheet[]`。

### 凭据

三个端点都不带三件套头。

- `userinfo`：无入参，`GET /oauth/v2/userinfo`，`access_token` 放在查询串上，答 `UserInfo`。
- `accessToken`（`AccessTokenInput`）：`{ clientId, clientSecret, code, redirectUri }`，`GET /oauth/v2/token`，`grant_type=authorization_code`，答 `TokenResponse`。
- `refreshToken`（`RefreshTokenInput`）：`{ clientId, clientSecret, refreshToken }`，同址，`grant_type=refresh_token`，答 `TokenResponse`。

## 坐标

记录端点寻址一份文档与一张子表，这对坐标是 `DocCoordinates`（`{ fileId, sheetId }`）。默认取 `TDocClientOptions.params`，调用自带的 `params` 覆盖它，覆盖可以只报一半，另一半由配置补上。

`getSheetList` 只寻址文档，它的覆盖只含 `fileId`。

## 官方参考

智能表：

- <https://docs.qq.com/open/document/app/openapi/v2/smartsheet/sheet/get_sheet.html>
- <https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/get_records.html>
- <https://docs.qq.com/open/document/app/openapi/v2/smartsheet/record/params.html>

OAuth：

- <https://docs.qq.com/open/document/app/oauth2/user_info.html>
- <https://docs.qq.com/open/document/app/oauth2/access_token.html>
- <https://docs.qq.com/open/document/app/oauth2/refresh_token.html>
