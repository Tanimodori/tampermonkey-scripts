# 日志

日志一行一个 JSON，字段与轮转规则见 [日志](../deploy/logging.md)。记录默认只写 stdout 与 stderr，只有给了路径才会写到文件。

两个文件 sink 是互斥的：`OPS_LOG_FILE_PATH` 与 `OPS_LOG_ROTATING_FILE_PATH` 不能同时设；只给某个 sink 的其它选项而不给它的 `PATH`，同样是配置错误。

## OPS_SERVER_LOG_LEVEL

- 类型：`枚举（debug / info / warning / error）`
- 默认值：`info`
- 记录的级别。`debug` 会增加限流器产生的逐条 Redis 记录、以及在上游队列里等待过的调用；其余记录（请求、腾讯文档调用、删除、失败）都在 `info` 及以上。

## OPS_SERVER_LOG_TIMEZONE

- 类型：`IANA 时区名`
- 默认值：`UTC`
- 只决定是否在 UTC 的 `@timestamp` 旁边多加一个 `timestampLocal` 字段：写 `UTC`（默认）时不加，写别的时区时每条记录都会带上本地时间，运行时无法解析的名字会让启动失败。nginx 容器的日志时区也从这里取，见 [编排](compose.md)。

## OPS_LOG_FILE_PATH

- 类型：`路径`
- 默认值：`无（不设则不写文件）`
- 普通文件 sink 的目标。目录不存在会创建；写不进去则启动失败。

## OPS_LOG_FILE_LAZY

- 类型：`布尔`
- 默认值：`false`
- 第一次写入时再打开文件，而不是启动时就打开。轮转 sink 没有这个选项。

## OPS_LOG_FILE_BUFFER_SIZE

- 类型：`整数`（字符数）
- 默认值：`8192`
- 攒够多少字符才写一次；`0` 表示每条记录立即写。

## OPS_LOG_FILE_FLUSH_INTERVAL_MS

- 类型：`时长（毫秒）`
- 默认值：`5000`
- 缓冲区没攒满时的强制刷写间隔；`0` 关掉这个定时器。退出时无论怎样都会刷一次。

## OPS_LOG_ROTATING_FILE_PATH

- 类型：`路径`
- 默认值：`无（不设则不写文件）`
- 轮转文件 sink 的目标。生产用它，写进 compose 挂给容器的 `/var/log/occult-pot-server`。

## OPS_LOG_ROTATING_FILE_MAX_SIZE

- 类型：`字节数`
- 默认值：`1048576`（1 MiB）
- 当前文件写到多少字节就轮转一次。备份名形如 `occult-pot-server.log.1`、`.2`，`.1` 是最新的一份。

## OPS_LOG_ROTATING_FILE_MAX_FILES

- 类型：`整数`（1–1000）
- 默认值：`5`
- 保留几份备份。

## OPS_LOG_ROTATING_FILE_BUFFER_SIZE

- 类型：`整数`（字符数）
- 默认值：`8192`
- 与 `OPS_LOG_FILE_BUFFER_SIZE` 相同，作用于轮转 sink。

## OPS_LOG_ROTATING_FILE_FLUSH_INTERVAL_MS

- 类型：`时长（毫秒）`
- 默认值：`5000`
- 与 `OPS_LOG_FILE_FLUSH_INTERVAL_MS` 相同，作用于轮转 sink。
