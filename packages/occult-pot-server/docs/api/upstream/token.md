# 凭据

访问文档需要三类标识：`client_id` 说明是哪个应用，`open_id` 说明是哪个用户，access token 说明这次请求经过授权。access token 有效期 30 天，refresh token 1 年；换取与刷新都只能由后台服务发起，密钥不进入浏览器可见的任何一处。

两个端点说的是两套话：获取用户信息回答在智能表的信封里，刷新 access token 的回答是一段裸的 token 对象——它拒绝授权时给出的 `error` 由调用它的一方解释。

## 端点一览

| 方法 | 路径                 | 说明                          |
| ---- | -------------------- | ----------------------------- |
| GET  | `/oauth/v2/userinfo` | 确认 access token 并读出身份  |
| GET  | `/oauth/v2/token`    | 用 refresh token 换新的 token |

## 通用约定

- 地址是 `${apiBase}` 加路径，`${apiBase}` 的默认值与含义见 [配置：腾讯文档](../../config/docs.md)。
- 两个端点都不带 `Access-Token`/`Client-Id`/`Open-Id` 头部三元组，凭据一律作为查询参数携带。
- 有效期告警阈值（`OPS_DOCS_TOKEN_EXPIRY_WARN_MS`）与凭据健康在 `/readyz` 的读法，见 [配置：腾讯文档](../../config/docs.md)与 [API 端点](../endpoints.md)。

## 获取用户信息

接口定义：[获取用户信息](https://docs.qq.com/open/document/app/oauth2/user_info.html)

### 功能

- 确认 access token 仍然有效。
- 读出它属于哪个用户，与配置的 `OPS_DOCS_OPEN_ID` 比对；不一致时启动失败。

### 参数

- `access_token`（查询参数）：待校验的 access token。

### 正常返回值

`data` 直接是 `UserInfo`，不按操作名分节：`openID` 是用户标识，`nick` 是昵称；其余 `avatar`、`source`、`bindSource`、`fileAuthType`、`unionID` 说明账号与授权来源，本服务不读。

```json
{
  "ret": 0,
  "msg": "Succeed",
  "data": { "openID": "OpenIDTest", "nick": "nickTest", "avatar": "https://example.com/avatar.png", "source": "qq", "unionID": "UnionIDTest" }
}
```

### 可能的报错

- `ERR_UPSTREAM_AUTH_FAILED`（503）：token 被上游拒绝，或凭据对该文档没有权限。
- `ERR_CONFIG_INVALID`（500）：配置了 `OPS_DOCS_OPEN_ID` 而上游报告的用户标识与它不一致；回答里没有用户标识时按不一致处理。
- `ERR_UPSTREAM_FAILED`（502）：上游 5xx、连不上、超时，或回答不是 JSON。
- `ERR_UPSTREAM_RATE_LIMITED`（503）：被上游限流，响应带 `Retry-After` 头。

## 刷新 access token

接口定义：[获取 Token](https://docs.qq.com/open/document/app/oauth2/access_token.html) 与 [刷新 Token](https://docs.qq.com/open/document/app/oauth2/refresh_token.html)

### 功能

- 用 refresh token 换一个新的 access token。
- 新 token 与其有效期写回 Redis，进程重启后继续有效；环境变量里的值只是初始值。
- 没有定时器调度刷新，凭据过期后由人工轮换。

### 参数

- `client_id`（查询参数）：应用标识。
- `client_secret`（查询参数）：应用密钥，只从环境变量读取。
- `grant_type`（查询参数）：固定为 `refresh_token`。
- `refresh_token`（查询参数）：当前保存的 refresh token。

### 正常返回值

一段没有信封的对象：`access_token`、`token_type`、`expires_in`（秒）、`scope`、`user_id`；部分流程同时下发新的 `refresh_token`，本服务一并保存。`expires_in` 缺省时以新 token 自身的过期声明为准。

```json
{ "access_token": "…", "token_type": "Bearer", "expires_in": 2592000, "scope": "scope.smartsheet", "user_id": "OpenIDTest" }
```

### 可能的报错

- `ERR_UPSTREAM_AUTH_FAILED`（503）：这一端点用 `400` 拒绝授权——那是一段回答而不是传输失败，由调用方解释为凭据不可用；HTTP 401/403 同样归为此码。
- `ERR_UPSTREAM_FAILED`（502）：上游 5xx、连不上、超时，或回答不是 JSON。
- `ERR_CONFIG_INVALID`（500）：没有配置 `OPS_DOCS_CLIENT_SECRET` 或 `OPS_DOCS_REFRESH_TOKEN`，无法发起刷新。

## 当前限制

测试文档的环境变量只有 access token，没有 `OPS_DOCS_CLIENT_SECRET` 与 `OPS_DOCS_REFRESH_TOKEN`，因此针对真实文档的测试只覆盖获取用户信息，不覆盖刷新；刷新回答的各个形状在按模拟上游的测试里覆盖。
