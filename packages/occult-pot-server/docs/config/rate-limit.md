# 入站限流

按客户端 IP 计算的滑动窗口，计数存在 Redis 里，多实例共享同一份。被限流时返回 `429` 与 `ERR_RATE_LIMITED`，并带 `RateLimit-*` 与 `Retry-After` 响应头；nginx 在前面还有一层更松的限制，见 [限流](../api/endpoints.md)。

## OPS_RATE_LIMIT_IP_WINDOW_MS

- 类型：`时长（毫秒）`
- 默认值：`60000`
- 两个限流器共用的窗口长度。

## OPS_RATE_LIMIT_IP_MAX

- 类型：`整数`
- 默认值：`120`
- 整个匿名 API 在每个窗口里允许的请求数。

## OPS_RATE_LIMIT_WRITE_MAX

- 类型：`整数`
- 默认值：`20`
- 写入（`POST`）在每个窗口里允许的请求数。它比上面那个紧，因为每次写入都要花腾讯文档的调用配额。
