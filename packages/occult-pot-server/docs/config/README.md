# 配置

配置项的完整清单，按主题分成下面几份。变量名由配置路径加 `OPS_` 前缀组成（`server.port` 对应 `OPS_SERVER_PORT`），compose 自己的可配置项以 `OPS_COMPOSE_` 打头。

- [服务](server.md)：监听地址、反向代理关系、跨域与请求体上限
- [日志](logging.md)：级别、时区与两个文件 sink
- [状态存储](redis.md)：Redis 地址与密码
- [腾讯文档](docs.md)：文档坐标与访问凭据
- [入站限流](rate-limit.md)：按客户端 IP 的两个滑动窗口
- [出站调用](upstream.md)：访问腾讯文档的节奏、重试、缓存与过期判定
- [编排](compose.md)：compose 的可配置项、配置来源与加载顺序、跨容器的变量

两份值文件是环境变量的清单：`.env.development` 带开发模式的值，`.env.production` 是生产的清单。仓库不发布 `.env`，存在时同样会被读取。默认值、取值规则与它们各自的来源见上面每份文档。
