# 日志

每条记录是一行 JSON（[LogTape](https://logtape.org)），字段包括 `@timestamp`（ISO 8601 UTC）、`level`（`DEBUG`、`INFO`、`WARN`、`ERROR`）、`message`、`logger`（记录分类，点号连接）以及该条记录的业务字段。设置 `OPS_SERVER_LOG_TIMEZONE` 后记录会多一个 `timestampLocal` 字段（同一时刻，带时区偏移）；默认不输出该字段，nginx 的访问日志使用同一个变量。

## 级别与脱敏

`OPS_SERVER_LOG_LEVEL` 决定记录的最低级别，stdout 与文件共用。

凭据按字段名脱敏（[`@logtape/redaction`](https://logtape.org/manual/redaction)）：名称以 `token`、`secret`、`password`、`cookie`、`apiKey` 等结尾的字段，值替换为 `[redacted]`。请求头、腾讯文档的响应体与 Redis 中保存的值不写入日志；调用地址中的查询串（凭据所在位置）同样不记录。

## 去处

- stdout 与 stderr：始终输出，`info` 及以下写 stdout，`warning` 及以上写 stderr。
- 文件：配置 `OPS_LOG_FILE_PATH` 或 `OPS_LOG_ROTATING_FILE_PATH` 之一，两者互斥；生产使用轮转文件，写入 `./logs/occult-pot-server.log`。

`./logs` 下还有 nginx 的访问日志，其轮转与用途见 [部署与运维交付物](deploy.md)。日志路径不可写时服务在启动阶段退出。

## 缓冲与轮转

文件写入默认缓冲 8 KB、最多 5 秒刷写一次；进程收到 `SIGTERM` 或 `SIGINT` 时先刷盘再退出，被 `SIGKILL` 终止时最后一段缓冲会丢失。轮转文件的备份名形如 `occult-pot-server.log.1`、`.2`，`.1` 为最新一份。

级别、时区与两个 sink 的变量见 [配置：日志](../config/logging.md)，选项的含义见 [LogTape 文件 sink](https://logtape.org/sinks/file)。
