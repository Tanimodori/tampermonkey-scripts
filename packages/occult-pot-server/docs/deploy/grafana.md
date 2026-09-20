# Grafana 面板

面板 `occult-pot-server`（uid `occult-pot`，标签 `occult-pot`）分四组：网页 API、腾讯文档上游、nginx 与 Redis、主机。每组里每块面板给出表达式与它在看什么；指标本身的含义见 [指标](metrics.md)，怎么打开界面见 [运行环境](setup.md)。

## 提供方式

- 数据源在 [`deploy/stats/grafana/provisioning/datasources/prometheus.yml`](../../deploy/stats/grafana/provisioning/datasources/prometheus.yml)：名字与 uid 都是 `prometheus`，`access: proxy`，地址 `http://prometheus:9090`（走容器网络，不经宿主端口），设为默认且在界面上不可改。它的 `timeInterval` 声明成 `120s`，与采集间隔一致，`$__rate_interval` 之类的推导才会落在真实的样本密度上。
- 面板在 [`deploy/stats/grafana/dashboards/occult-pot.json`](../../deploy/stats/grafana/dashboards/occult-pot.json)，由 [`provisioning/dashboards/dashboards.yml`](../../deploy/stats/grafana/provisioning/dashboards/dashboards.yml) 这个 provider 以 `type: file` 读出，挂在容器内的 `/var/lib/grafana/dashboards`，归入 `occult-pot` 文件夹，每 300s 重扫一次目录。`allowUiUpdates` 关闭，界面上的改动不会写回文件。
- 两者都随 `stats/` 一起上传，改面板要改仓库里的 JSON：容器重建后拿到的始终是这一套，见 [部署与运维](deployment.md)。

## 变量与时间

- 一个模板变量 `datasource`（标签「数据源」），所有面板都引用它，因此同一份 JSON 可以指到别的 Prometheus 实例。
- 自动刷新 `1m`，默认时间窗 `now-6h` 到 `now`，时区随浏览器。
- 表达式里的窗口从 10m 起步，慢变量用 30m 与 1h；这个下限是采集间隔决定的，见 [指标](metrics.md)。

## 网页 API

**请求速率（按路由）— timeseries · reqps · 堆叠**

总流量与它在路由之间的分布。`unmatched` 被排除，扫描流量不在这块面板上，它单独在「被限流的请求」里。

```promql
sum by (route) (rate(occult_pot_http_requests_total{route!="unmatched"}[10m]))
```

**状态码（4xx / 5xx）— timeseries · reqps · 堆叠**

只看非 2xx、3xx 的部分，按状态码拆开。

```promql
sum by (status) (rate(occult_pot_http_requests_total{status=~"[45].."}[10m]))
```

**错误比例 — timeseries · percentunit**

两条线分别是 5xx 与 4xx 占总请求的比例。`clamp_min` 让零流量时结果为 0 而不是 `NaN`。

```promql
sum(rate(occult_pot_http_requests_total{status=~"5.."}[10m])) / clamp_min(sum(rate(occult_pot_http_requests_total[10m])), 1e-9)
sum(rate(occult_pot_http_requests_total{status=~"4.."}[10m])) / clamp_min(sum(rate(occult_pot_http_requests_total[10m])), 1e-9)
```

**延迟分位 — timeseries · s**

p50、p95、p99 三条线，全部路由合并。分位数是桶间插值出来的，桶边界是精度上限。

```promql
histogram_quantile(0.5, sum by (le) (rate(occult_pot_http_request_duration_seconds_bucket[10m])))
histogram_quantile(0.95, sum by (le) (rate(occult_pot_http_request_duration_seconds_bucket[10m])))
histogram_quantile(0.99, sum by (le) (rate(occult_pot_http_request_duration_seconds_bucket[10m])))
```

**被限流的请求 — timeseries · reqps**

一条是被限流的 `429`，一条是没匹配上任何路由的请求（扫描与探测）。两条都持续偏高时才需要动作，判据见 [限速](rate-limit.md)。

```promql
sum(rate(occult_pot_http_requests_total{status="429"}[10m]))
sum(rate(occult_pot_http_requests_total{route="unmatched"}[10m]))
```

## 腾讯文档上游

**调用速率（按调用与结果）— timeseries · reqps · 堆叠**

每种调用各自一条线，成功与失败叠在一起，看得出流量落在哪个操作上。

```promql
sum by (operation, result) (rate(occult_pot_upstream_requests_total[10m]))
```

**可用率（成功占全部尝试）— timeseries · percentunit**

上游的主指标。窗口用 1h，因为上游调用是慢变量，10m 里往往没有几个样本。分母是全部尝试，所以重试的代价算在里面。

```promql
sum by (operation) (rate(occult_pot_upstream_requests_total{result="ok"}[1h]))
  / clamp_min(sum by (operation) (rate(occult_pot_upstream_requests_total[1h])), 1e-9)
```

**失败构成 — timeseries · reqps · 堆叠**

把失败按错误码拆开：凭据被拒、被限流、参数不对还是传输失败，三者的处置不同。

```promql
sum by (result) (rate(occult_pot_upstream_requests_total{result!="ok"}[30m]))
```

**上游延迟（p95，按调用）— timeseries · s**

每种调用的 p95。它只计一次尝试的网络与对端时间，等令牌与重试退避不在内。

```promql
histogram_quantile(0.95, sum by (le, operation) (rate(occult_pot_upstream_request_duration_seconds_bucket[10m])))
```

**重试 — timeseries · reqps**

比可用率先动的信号：窗口 30m，只要上游开始抖动这里就会抬起来。

```promql
sum by (operation) (rate(occult_pot_upstream_retries_total[30m]))
```

**实例就绪（1 = 可服务上游）— stat**

绿色 1、红色 0。0 说明坐标没核对上或凭据已过期，此时接口只会回答错误。它不反映腾讯文档是否可达。

```promql
occult_pot_upstream_ready
```

**凭据剩余时间（未知为 0）— stat · s**

倒计时刻，阈值是 3 天转橙、7 天转绿。`> 0` 那一项把「未知」乘成空值，避免 0 被读成「已经过期」。

```promql
(occult_pot_credential_expires_at_timestamp_seconds > 0) * (occult_pot_credential_expires_at_timestamp_seconds - time())
```

**上游目标可用（10 分钟内最低）— stat**

每个 job 一条，取最近 10 分钟的最低值，任一时段抓不到就显示 0。用来回答「面板空白是因为没数据还是因为真没请求」。

```promql
min by (job) (min_over_time(up[10m]))
```

## nginx 与 Redis

**nginx 连接 — timeseries**

在处理的连接与 keepalive 空闲连接。`waiting` 高是长连接被复用，属正常；`active` 持续走高才要留意。

```promql
nginx_connections_active
nginx_connections_waiting
```

**nginx 请求速率与被丢弃的连接 — timeseries · reqps**

一条是请求速率，一条是「接受但未处理」的连接速率，即因资源不足被丢弃的部分，正常应当是 0。

```promql
rate(nginx_http_requests_total[10m])
rate(nginx_connections_accepted[10m]) - rate(nginx_connections_handled[10m])
```

**Redis 内存 — timeseries · bytes**

用量与上限两条线。本部署没有给 Redis 配 `maxmemory`，上限那条恒为 0，只有用量线有意义。

```promql
redis_memory_used_bytes
redis_memory_max_bytes
```

**Redis 命令速率与命中率 — timeseries**

一条是累计命令算出的速率，一条是命中率。命中率掉下来意味着缓存失效或键被清掉。

```promql
rate(redis_commands_processed_total[10m])
rate(redis_keyspace_hits_total[10m]) / clamp_min(rate(redis_keyspace_hits_total[10m]) + rate(redis_keyspace_misses_total[10m]), 1e-9)
```

**Redis 客户端与键数量 — timeseries**

连接数、键总数与淘汰速率三条线一起看。出现淘汰说明内存已经紧张，连接数持续增长指向客户端没复用连接。

```promql
redis_connected_clients
sum(redis_db_keys)
rate(redis_evicted_keys_total[10m])
```

## 主机

`node-exporter` 报的是宿主机数值，不是容器内的，与 `occult_pot_process_*` 那组对照着看。

**CPU 使用率 — timeseries · percentunit**

```promql
1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[10m]))
```

**内存使用率 — timeseries · percentunit**

`MemAvailable` 已经把可回收的缓存算进去。

```promql
1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes
```

**磁盘使用率 — timeseries · percentunit**

按挂载点一条，过滤掉伪文件系统。

```promql
1 - node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"} / node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs"}
```

**负载与运行时间 — timeseries**

`load1`、`load5` 与主机运行时长。负载要和核数一起看，运行时长突然归零说明宿主机重启过。

```promql
node_load1
node_load5
time() - node_boot_time_seconds
```

**网络吞吐 — timeseries · Bps**

收发各按网卡一条，排掉 `lo` 与 docker 的虚拟设备，否则曲线会被容器内部的流量占满。

```promql
rate(node_network_receive_bytes_total{device!~"lo|veth.*|docker.*|br-.*"}[10m])
rate(node_network_transmit_bytes_total{device!~"lo|veth.*|docker.*|br-.*"}[10m])
```
