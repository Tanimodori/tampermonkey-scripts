# 日志

应用与 nginx 各写一份日志，都在部署根的 `logs/` 下。

## 记录格式

每条记录是一行 JSON（[LogTape](https://logtape.org)），字段包括 `@timestamp`（ISO 8601 UTC）、`level`（`DEBUG`、`INFO`、`WARN`、`ERROR`）、`message`、`logger`（记录分类，点号连接）以及该条记录的业务字段。设置 `OPS_SERVER_LOG_TIMEZONE` 后记录会多一个 `timestampLocal` 字段（同一时刻，带时区偏移）；默认不输出该字段，nginx 的访问日志使用另一个变量。

`logs/nginx-access.log` 同样是每行一条 JSON，由 nginx 的 `log_format` 写出，字段顺序固定，其中 `status` 排在 `uri` 之前——fail2ban 的匹配规则依赖这个顺序。

## 级别与脱敏

`OPS_SERVER_LOG_LEVEL` 决定记录的最低级别，stdout 与文件共用。

凭据按字段名脱敏（[`@logtape/redaction`](https://logtape.org/manual/redaction)）：名称以 `token`、`secret`、`password`、`cookie`、`apiKey` 等结尾的字段，值替换为 `[redacted]`。请求头、腾讯文档的响应体与 Redis 中保存的值不写入日志；调用地址中的查询串（凭据所在位置）同样不记录。

## 去处

- stdout 与 stderr：应用始终输出，`info` 及以下写 stdout，`warning` 及以上写 stderr，`docker compose logs` 读的就是它。
- 文件：配置 `OPS_LOG_FILE_PATH` 或 `OPS_LOG_ROTATING_FILE_PATH` 之一，两者互斥；生产使用轮转文件，写入 `logs/occult-pot-server.log`。
- nginx 的访问日志：写入 `logs/nginx-access.log`，由 fail2ban 与 logrotate 读取，两者的安装步骤见 [部署与运维](deployment.md)。

日志路径不可写时服务在启动阶段退出。

## 缓冲与轮转

文件写入默认缓冲 8 KB、最多 5 秒刷写一次；进程收到 `SIGTERM` 或 `SIGINT` 时先刷盘再退出，被 `SIGKILL` 终止时最后一段缓冲会丢失。轮转文件的备份名形如 `occult-pot-server.log.1`、`.2`，`.1` 为最新一份。

nginx 的访问日志由 logrotate 轮转，规则用 `copytruncate`，因此 nginx 不必重开文件。

级别、时区与两个 sink 的变量见 [配置：日志](../config/logging.md)，选项的含义见 [LogTape 文件 sink](https://logtape.org/sinks/file)。
