# 状态存储

罐子缓存、限流计数与调用者的访问记录都在 Redis 里，按客户端 IP 计数的那两个窗口也由多实例共享同一份。

## OPS_SERVER_REDIS_URL

- 类型：`URL`（`redis://[用户名:密码@]主机:端口/库`）
- 默认值：`无`（未设置时使用进程内的 Redis mock）
- 地址。**不设置就是选用进程内实现**：写进去的东西不跨进程，生产启动时会记一条 warning。容器部署指向 compose 里的 `redis` 服务，即 `redis://redis:6379`。

## OPS_SERVER_REDIS_PASSWORD

- 类型：`字符串`
- 默认值：`无`
- 密码单独给，地址就能保持成一个可以安全记日志的普通值。把密码写在地址里也可以，两者都有时这个变量优先；空值等于没设。compose 里 Redis 自己也从这个变量取 `--requirepass`，所以两边不会不一致。不设就没有密码，这一点只因为 Redis 的端口从不发布才算安全。启动记录 `Configuration resolved` 会说明是否配了密码。
