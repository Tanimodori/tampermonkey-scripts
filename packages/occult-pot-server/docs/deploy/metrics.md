# 指标

Prometheus 有五个抓取目标，也就是五个数据来源：应用自身，加上三个 exporter 与 Prometheus 自己的自检指标。每个条目写它的类型、标签、取值范围与它回答的问题；端口与可达性见 [运行环境](setup.md)，面板怎么用这些表达式见 [Grafana 面板](grafana.md)。标签的每个组合各占一条时间序列，这里的取值域都是固定的，序列数不会随流量发散。

## 怎么读这些指标

**三种形态。** 抓取时读到的是「这一瞬间的值」，指标本身分三类：

- counter 只增不减，例如 `... _total`。它回答「累计发生了多少次」，要算速率得用 `rate()` 比较两个样本的差。
- gauge 是可升可降的瞬时值。120s 抓一次就是每两分钟抽样一次，尖峰可能被漏掉。
- histogram 是一组 `_bucket{le="0.5"}` 累计桶加上 `_sum` 与 `_count`。分位数是查询时用桶插值算出来的，桶边界就是精度上限。

**Prometheus 只拉取，不算数。** 它每 120s 对每个目标发一次 `GET /metrics`，把文本按「指标名 + 标签组合」拆成时间序列存下来；`rate()`、错误率、分位、可用率都是查询时算的。counter 的增量在 120s 间隔下依然准确；gauge 是抽样；histogram 的分位在窗口内样本太少时很粗糙，所以面板窗口从 10m 起。

**进程内与 exporter 两种来源。** 应用自己报的指标由进程内的客户端维护，抓取时只把当前值序列化出来；`exporter` 是「翻译进程」，Prometheus 每次抓它时它才去读一次真实上游（nginx 的 `stub_status` 页面、Redis 的 `INFO`、宿主机的 `/proc` 与 `/sys`）。所以 `up` 表示 exporter 活着并回了文本，`redis_up` 这类指标才表示它读上游成功没有。

## 应用自身（occult-pot-server）

抓取地址 `occult-pot-server:3000/metrics`，只有容器网络内可达。这里的指标统一带 `occult_pot_` 前缀，以便和 exporter 的指标区分。

### occult_pot_http_requests_total

- 类型：counter
- 标签：`method`、`route`、`status`
- 取值范围：`route` 是匹配到的路由模板 `/api/v1/pots`、`/healthz`、`/readyz`，没匹配上任何路由时记 `unmatched`；`status` 是三位 HTTP 状态码的字符串。`/metrics` 自身不计数。
- 含义：接口被调用了多少次、结果如何分布。响应结束时加一；被限流、被拒、404 这些短路回答同样计入。

### occult_pot_http_request_duration_seconds

- 类型：histogram
- 标签：`method`、`route`（不含 `status`）
- 取值范围：桶边界 0.01、0.05、0.1、0.25、0.5、1、2、5、10 秒。
- 含义：接口的快慢。同一处在响应结束时记录耗时；桶铺到 10 秒是因为写入要等上游。

### occult_pot_upstream_requests_total

- 类型：counter
- 标签：`operation`、`result`
- 取值范围：`operation` 取 `getRecords`、`addRecords`、`updateRecords`、`deleteRecords`、`getSheet`、`userinfo`、`refreshToken`；`result` 取 `ok` 或 `ERR_UPSTREAM_BAD_REQUEST`、`ERR_UPSTREAM_AUTH_FAILED`、`ERR_UPSTREAM_RATE_LIMITED`、`ERR_UPSTREAM_FAILED`，见 [错误处理](../api/errors.md)。
- 含义：上游可用情况的主指标。每次调用结束时记一次：失败的调用不会被服务端重发，所以一次调用只记一次。`ok` 指调用方拿到了一个按端点类型读得出来的回答，回答读不出来记在失败那一侧。

### occult_pot_upstream_request_duration_seconds

- 类型：histogram
- 标签：`operation`、`result`
- 取值范围：桶边界 0.05、0.1、0.25、0.5、1、2、5、10、30 秒。
- 含义：一次调用的耗时，从拿到出站队列的令牌到本次调用返回（含把回答按其类型读一遍）。等令牌的时间不在内，所以它变慢只可能是网络、对端或回答的体积；排队的迹象在出站队列的 debug 日志里。

### occult_pot_upstream_ready

- 类型：gauge
- 标签：无
- 取值范围：`1` 或 `0`，抓取时现算。
- 含义：1 表示文档坐标已核对且凭据未过期。这个判断只在我方做，不访问腾讯文档：对方整体挂掉时它仍然是 1，另一半由 `occult_pot_upstream_requests_total` 的失败比例报告。

### occult_pot_credential_expires_at_timestamp_seconds

- 类型：gauge
- 标签：无
- 取值范围：正数是凭据到期时刻的 Unix 时间戳（秒）；`0` 表示到期时刻未知——真实到期时刻一定是正数，而无标签的 gauge 每次抓取都会输出一个值。
- 含义：用 `- time()` 得到剩余秒数，可以提前安排轮换。面板与告警都要先用 `> 0` 把「未知」滤掉，否则它会被读成「已过期」。

### 进程与运行时

由客户端库的默认集合产出，抓取时读当前值；完整清单以抓到的输出为准。

- CPU：`occult_pot_process_cpu_seconds_total`（counter，累计 CPU 秒，`rate()` 后是核数占用），另有 `occult_pot_process_cpu_user_seconds_total` 与 `occult_pot_process_cpu_system_seconds_total` 两个分量。
- 内存：`occult_pot_process_resident_memory_bytes`（gauge，RSS，容器内存的主要来源），另有 `occult_pot_process_virtual_memory_bytes`、`occult_pot_process_heap_bytes`。
- 文件描述符：`occult_pot_process_open_fds` 与 `occult_pot_process_max_fds`（gauge），用量与上限，是泄漏或打满前的预警。
- 启动时刻：`occult_pot_process_start_time_seconds`（gauge，Unix 秒），用来算 uptime、发现重启。
- 事件循环：`occult_pot_nodejs_eventloop_lag_seconds`（gauge，另有 min、max、mean、stddev 与 p50、p90、p99），以及 `occult_pot_nodejs_eventloop_utilization_histogram`（histogram）与同名的 `_summary`（summary）。Node 只有一个线程，这几组直接反映它忙不忙。
- 堆：`occult_pot_nodejs_heap_size_total_bytes` 与 `_used_bytes`、`occult_pot_nodejs_heap_space_size_total_bytes{space}` 与 `_used_bytes`、`_available_bytes`、`occult_pot_nodejs_external_memory_bytes`（都是 gauge）。
- GC：`occult_pot_nodejs_gc_duration_seconds{kind}`（histogram），`kind` 区分 `minor`、`major`、`incremental`、`weakcb`。
- 活跃资源：`occult_pot_nodejs_active_resources{type}` 与 `_total`、`occult_pot_nodejs_active_handles{type}` 与 `_total`、`occult_pot_nodejs_active_requests{type}` 与 `_total`（gauge）。
- 版本：`occult_pot_nodejs_version_info{version,major,minor,patch}`（gauge，值恒为 1，信息在标签里）。

这里没有容器级的内存与 CPU 上限，RSS 与 CPU 都是容器内的视角；少数指标要平台支持，例如文件描述符两项来自 Linux 的 `/proc`。

## nginx-exporter

抓取地址 `nginx-exporter:9113/metrics`，它读的是 `nginx:8080/stub_status`。计数是 nginx 全局的：放在 8080 的监控监听上，统计的仍然是 nginx 收到的全部请求，包括 80 端口上的 API 流量、扫描流量和抓取本身。

### nginx_connections_active / nginx_connections_reading / nginx_connections_writing / nginx_connections_waiting

- 类型：gauge
- 标签：无
- 取值范围：当前连接数，非负整数。
- 含义：`active` 是在处理的连接，`reading`、`writing` 是按阶段拆开的部分，`waiting` 是 keepalive 的空闲连接。

### nginx_connections_accepted / nginx_connections_handled

- 类型：counter（名字里没有 `_total`）
- 标签：无
- 取值范围：自启动起的累计连接数。
- 含义：接受的连接与成功处理的连接。两者之差是因资源不足被丢弃的连接，值得告警。

### nginx_http_requests_total

- 类型：counter
- 标签：无
- 取值范围：自启动起的累计请求数。
- 含义：请求总数，含被 404 掉的扫描流量与抓取本身。

### nginx_up

- 类型：gauge
- 标签：无
- 取值范围：`1` 或 `0`。
- 含义：exporter 这次读 `stub_status` 是否成功。它和 `up` 是两件事：`up` 只说 exporter 活着。

## redis-exporter

抓取地址 `redis-exporter:9121/metrics`，它读的是 Redis 的 `INFO`。指标名是 `redis_` 加 `INFO` 里的字段名，个别字段被改名（例如 `used_memory` 对应 `redis_memory_used_bytes`）；完整清单以抓到的输出为准。

### redis_up

- 类型：gauge
- 标签：无
- 取值范围：`1` 或 `0`。
- 含义：这次读 `INFO` 是否成功。它是这套 Redis 指标的总开关，为 0 时其他指标也停了。

### redis_memory_used_bytes / redis_memory_max_bytes

- 类型：gauge
- 标签：无
- 取值范围：字节数。
- 含义：内存用量与上限，相除是使用率。上限取自 Redis 的 `maxmemory`，本部署没有配它，所以这一条恒为 0、使用率算不出来，只有用量线有意义。

### redis_instantaneous_ops_per_sec

- 类型：gauge
- 标签：无
- 取值范围：每秒命令数，Redis 自己按最近一段窗口估算。
- 含义：当前的命令速率，是抽样值。

### redis_commands_processed_total

- 类型：counter
- 标签：无
- 取值范围：自启动起的累计命令数。
- 含义：累计处理过的命令；要速率得 `rate()`。

### redis_keyspace_hits_total / redis_keyspace_misses_total

- 类型：counter
- 标签：无
- 取值范围：自启动起的累计命中数与未命中数。
- 含义：两者相除是缓存命中率。缓存失效会让它掉下来。

### redis_connected_clients

- 类型：gauge
- 标签：无
- 取值范围：当前连接客户端数。
- 含义：有几个客户端连着，应用实例与 `redis-exporter` 自己在其中。

### redis_db_keys

- 类型：gauge
- 标签：`db`
- 取值范围：每个逻辑库的键数。
- 含义：键空间的大小；`sum(redis_db_keys)` 是总数。

### redis_expired_keys_total / redis_evicted_keys_total

- 类型：counter
- 标签：无
- 取值范围：自启动起的累计键数。
- 含义：因 TTL 过期而被清理的键，与因内存不够被淘汰的键。出现淘汰说明内存紧张。

### redis_uptime_in_seconds

- 类型：gauge
- 标签：无
- 取值范围：秒。
- 含义：实例活了多久，用来发现重启。

AOF 与 RDB 的状态类指标（`redis_aof_*`、`redis_rdb_*`，gauge 与 counter 混合）说明持久化是否正常、上一次落盘在什么时候，完整清单以抓到的输出为准。

## node-exporter

抓取地址 `node-exporter:9100/metrics`。它读的是挂载进来的宿主根（`--path.rootfs=/host`），所以这些是宿主机而不是容器的数值。

### node_cpu_seconds_total

- 类型：counter
- 标签：`cpu`、`mode`
- 取值范围：`mode` 取 `user`、`system`、`idle`、`iowait`、`irq`、`softirq`、`steal` 等；`cpu` 是编号。
- 含义：按核、按模式累计的 CPU 秒。常用法是拿 `idle` 占比反算使用率。

### node_memory_MemTotal_bytes / node_memory_MemAvailable_bytes

- 类型：gauge
- 标签：无
- 取值范围：字节数。
- 含义：内存总量与可用量；`MemAvailable` 已经把可回收的缓存算进去了。

### node_filesystem_size_bytes / node_filesystem_avail_bytes

- 类型：gauge
- 标签：`device`、`mountpoint`、`fstype`
- 取值范围：字节数，每个挂载点一组。
- 含义：磁盘容量与剩余。查用量时要过滤 `tmpfs`、`overlay`、`squashfs` 这类伪文件系统。

### node_network_receive_bytes_total / node_network_transmit_bytes_total

- 类型：counter
- 标签：`device`
- 取值范围：累计字节数，每块网卡收发各一条。
- 含义：网卡流量。看宿主机的真实流量时要排掉 `lo`、`veth.*`、`docker.*`、`br-.*` 这些虚拟设备。

### node_load1 / node_load5 / node_load15

- 类型：gauge
- 标签：无
- 取值范围：分别是 1、5、15 分钟移动平均的活跃任务数，含等待 I/O 的。
- 含义：负载。要和核数一起看才知道算不算忙。

### node_boot_time_seconds / node_time_seconds

- 类型：gauge
- 标签：无
- 取值范围：Unix 时间戳（秒）。
- 含义：启动时刻与当前时间，`time() - node_boot_time_seconds` 是运行时长。

### node_scrape_collector_success / node_scrape_collector_duration_seconds

- 类型：gauge
- 标签：`collector`
- 取值范围：成功标志为 `1` 或 `0`，耗时为秒。
- 含义：采集器自身的健康。某个采集器读不到东西时，它负责的那几条指标这一轮不会更新，在这里能看到出问题的采集器。

## Prometheus 自身

抓取地址 `localhost:9090/metrics`。这一组是抓取自检，用来判断「没有数据」是没抓还是真没发生。

### up

- 类型：gauge
- 标签：`job`、`instance`
- 取值范围：抓取成功 `1`、失败 `0`。
- 含义：目标是否可达的第一手数据。120s 一次采样时单点 0 可能是抖动，看 `min_over_time(up[10m])` 更稳。

### scrape_duration_seconds / scrape_samples_scraped / scrape_samples_post_metric_relabeling

- 类型：Prometheus 的内建抓取指标，两条样本数是 gauge，耗时那条的形态以抓到的输出为准。
- 标签：`job`、`instance`
- 取值范围：耗时为秒，样本数为整数。
- 含义：这次抓取花了多久、拿到多少样本、重标签之后还剩多少。样本数突然变化通常意味着标签基数变了。

## 常用查询

```promql
# 按路由的请求速率
sum by (route) (rate(occult_pot_http_requests_total[10m]))

# 5xx 比例
sum(rate(occult_pot_http_requests_total{status=~"5.."}[10m]))
  / clamp_min(sum(rate(occult_pot_http_requests_total[10m])), 1e-9)

# 延迟分位
histogram_quantile(0.95, sum by (le, route) (rate(occult_pot_http_request_duration_seconds_bucket[10m])))

# 上游可用率，按调用拆（慢变量，窗口用 1h）
sum by (operation) (rate(occult_pot_upstream_requests_total{result="ok"}[1h]))
  / clamp_min(sum by (operation) (rate(occult_pot_upstream_requests_total[1h])), 1e-9)

# 失败构成：是凭据、限流还是传输失败
sum by (result) (rate(occult_pot_upstream_requests_total{result!="ok"}[30m]))

# 凭据剩余时间（0 表示未知）
(occult_pot_credential_expires_at_timestamp_seconds > 0)
  * (occult_pot_credential_expires_at_timestamp_seconds - time())

# 目标不可达
min_over_time(up[10m]) == 0

# 主机
1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[10m]))
1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes
1 - node_filesystem_avail_bytes{fstype!~"tmpfs|overlay|squashfs"} / node_filesystem_size_bytes{fstype!~"tmpfs|overlay|squashfs"}
```
