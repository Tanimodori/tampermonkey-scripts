# HTTP 服务

服务自身的监听地址、反向代理关系与请求体上限。取值来自环境变量或环境文件，空值与未设置等价。

## OPS_SERVER_PORT

- 类型：`整数`（1–65535）
- 默认值：`3000`
- 服务监听的端口。容器里由 compose 固定为 `3000`，nginx 反代到这个端口，所以部署时不需要改它。

## OPS_SERVER_HOST

- 类型：`字符串`（地址）
- 默认值：`0.0.0.0`
- 绑定的地址。容器要绑全部接口才能被网络里的其它容器访问；绑 `127.0.0.1` 时即使发布了端口也连不上。

## OPS_SERVER_TRUST_PROXY

- 类型：`数字或布尔`
- 默认值：`false`
- 信任的反向代理跳数。前面有一层 nginx 时写 `1`，Express 就会从最右侧的 `X-Forwarded-For` 取客户端地址，而不是拿代理的地址，按 IP 的限流才算得准。也可以写 `true`/`false` 或 Express 接受的子网名。交付的 compose 在服务定义里把它固定为 `1`。

## OPS_SERVER_CORS_ORIGINS

- 类型：`逗号分隔的来源列表`，或 `*`
- 默认值：`*`
- 允许跨域读取的来源。只放开读取（GET、HEAD、OPTIONS），写入（POST）仍然同源。

## OPS_SERVER_JSON_BODY_LIMIT

- 类型：`字节数`（字符串形式，例如 `64kb`）
- 默认值：`64kb`
- 请求体上限。超过时返回服务自己的 `ERR_PAYLOAD_TOO_LARGE`；nginx 自己的上限比它宽，只作为兜底。
