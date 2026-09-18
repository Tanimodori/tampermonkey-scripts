# 监控

监控组是 [`docker-compose.yml`](../docker-compose.yml) 里的 `stats` profile：Prometheus、Grafana，以及三个 exporter。它默认不启动，`docker compose up -d` 的行为与没有它时完全一样。

```
occult-pot-server:3000/metrics ◀──┐
redis-exporter:9121 ──▶ redis      │  每 120s 抓一次
nginx-exporter:9113 ──▶ nginx:8080 ├─ Prometheus ──▶ Grafana
node-exporter:9100（宿主 /proc 等）│      （数据源）
Prometheus 自身                    ◀──┘
```

应用自己报的指标只有容器网络里的人能读：nginx 不转发 `/metrics`，公网访问 `http://${host}:29070/metrics` 得到的是纯文本 `404 Not Found`。

## 端口

| 服务                | 容器内监听 | 网络内地址               | 主机发布                                                  | 隧道   |
| ------------------- | ---------- | ------------------------ | --------------------------------------------------------- | ------ |
| `occult-pot-server` | 3000       | `occult-pot-server:3000` | 不发布                                                    | —      |
| `nginx`             | 80         | `nginx:80`               | `${OPS_COMPOSE_NGINX_PORT}`（默认 `29070`）               | —      |
| `nginx`（监控用）   | 8080       | `nginx:8080`             | 不发布                                                    | —      |
| `redis`             | 6379       | `redis:6379`             | 不发布                                                    | —      |
| `prometheus`        | 9090       | `prometheus:9090`        | `127.0.0.1:${OPS_COMPOSE_PROMETHEUS_PORT}`（默认 `9090`） | `9090` |
| `grafana`           | 9999       | `grafana:9999`           | `127.0.0.1:${OPS_COMPOSE_GRAFANA_PORT}`（默认 `9999`）    | `9999` |
| `redis-exporter`    | 9121       | `redis-exporter:9121`    | 不发布                                                    | —      |
| `nginx-exporter`    | 9113       | `nginx-exporter:9113`    | 不发布                                                    | —      |
| `node-exporter`     | 9100       | `node-exporter:9100`     | 不发布                                                    | —      |

两个发布出来的端口都只绑在服务器回环上，所以它们是给隧道用的：公网扫不到，同一台机器之外的地址也连不上。Prometheus 没有自带鉴权，回环绑定就是它的保护；Grafana 用自带账号登录，密码来自配置。这几个端口变量的含义与取值方式见 [配置：编排](config/compose.md)。

容器内看指标（这也是核对抓取是否正常时最直接的办法）：

```bash
docker compose exec prometheus wget -qO- http://occult-pot-server:3000/metrics | head
docker compose exec prometheus wget -qO- http://redis-exporter:9121/metrics | head
docker compose exec prometheus wget -qO- http://nginx-exporter:9113/metrics | head
docker compose exec prometheus wget -qO- http://node-exporter:9100/metrics | head
docker compose exec prometheus wget -qO- http://localhost:9090/api/v1/targets
```

## 启停

```bash
docker compose --profile stats up -d     # 拉起监控组（业务服务本来就在跑）
docker compose --profile stats down      # 停掉监控组
docker compose ps                        # 关注的端口只有 29070、127.0.0.1:9999、127.0.0.1:9090
```

Prometheus 与 Grafana 的数据放在命名卷 `prometheus-data` 与 `grafana-data` 里；`down` 不会删它们，`down -v` 会。

## 访问

[`deploy/stats/ssh/config.occult-pot.sample`](../deploy/stats/ssh/config.occult-pot.sample) 是一份可以追加到本机 `~/.ssh/config` 的片段：把 `${host}`、`${user}` 换成部署的实际值，之后一条命令同时开两个转发。

```bash
ssh -N occult-pot          # 只做转发，不在服务器上开 shell
```

- Grafana：`http://127.0.0.1:9999`
- Prometheus：`http://127.0.0.1:9090`

本地 9999 或 9090 被占用时，改片段里 `LocalForward` 左边的本地端口即可。Grafana 的端口被改过的话，还要把 `GF_SERVER_ROOT_URL` 改成浏览器实际用的地址，否则登录跳转与页面里的链接会指回 `9999`。服务器侧需要允许本地转发：`sshd -T | grep allowtcpforwarding` 应为 `yes` 或 `local`。

不想开隧道时，用 Grafana 的 Explore 查 PromQL，或按下面「需要对外暴露时」把 Grafana 发布出去。

## 登录与密码

Grafana 用自带账号，管理员密码来自 `GF_SECURITY_ADMIN_PASSWORD`（值写在 `.env.production.local`，清单在 [`.env.production`](../.env.production)）。这个变量为空时容器直接退出并说明原因，不会退回 `admin`/`admin`。

这个变量只在管理员账号**第一次被创建**时生效。实例已经初始化过（`grafana-data` 里有数据）之后再改它不会改掉已有密码，轮换要用界面，或者：

```bash
docker compose exec grafana grafana cli --homepath /usr/share/grafana admin reset-admin-password '<新密码>'
```

## 需要对外暴露时

默认不暴露，要暴露就改三处：

1. `docker-compose.yml` 里 Grafana 的端口映射，把 `127.0.0.1:` 换成对外地址；
2. `GF_SERVER_ROOT_URL` 改成浏览器实际访问的地址（例如 `https://stats.example.com/`）；
3. 云安全组放行该端口，前面最好再有一层 TLS 终止，并相应设 `GF_SECURITY_COOKIE_SECURE=true`。

Prometheus 建议一直留在回环上：它没有鉴权，要暴露必须先配 `--web.config.file` 的 `basic_auth_users`。暴露之后可以再考虑匿名只读、反向代理鉴权或接 SSO，见文末「鉴权的升级路径」。

## 怎么读这些指标

**三种形态。** 抓取时读到的是「这一瞬间的值」，指标本身分三类：

- counter 只增不减，例如 `... _total`。它回答「累计发生了多少次」，要算速率得用 `rate()` 比较两个样本的差。
- gauge 是可升可降的瞬时值。120s 抓一次就是每两分钟抽样一次，尖峰可能被漏掉。
- histogram 是一组 `_bucket{le="0.5"}` 累计桶加上 `_sum` 与 `_count`。分位数是查询时用桶插值算出来的，桶边界就是精度上限。

**Prometheus 只拉取，不算数。** 它每 120s 对每个目标发一次 `GET /metrics`，把文本按「指标名 + 标签组合」拆成时间序列存下来；`rate()`、错误率、分位、可用率都是查询时算的。所以：

- 标签是维度：`{method,route,status}` 的每个组合各占一条序列。这里的取值域都是固定的（`route` 只有几条路由模板，没匹配上记 `unmatched`；`operation` 是代码里的常量），所以序列数不会随流量发散。
- 目标抓不到时，Prometheus 会给这个目标产出 `up 0`，抓到是 `up 1`。
- counter 的增量在 120s 间隔下依然准确；gauge 是抽样；histogram 的分位在窗口内样本太少时很粗糙，所以面板窗口从 10m 起。

**两个来源。** 应用自己报的指标由进程内的客户端维护，抓取时只把当前值序列化出来；`exporter` 是「翻译进程」，Prometheus 每次抓它时它才去读一次真实上游（nginx 的 `stub_status` 页面、Redis 的 `INFO`、宿主机的 `/proc` 与 `/sys`）。所以 `up` 表示 exporter 活着并回了文本，`redis_up` 这类指标才表示它读上游成功没有。

**四个容易读错的地方。**

- `occult_pot_upstream_requests_total` 计的是**尝试**，不是一次业务调用。一次调用第一次失败、重试成功后，会留下一条失败的与一条 `ok` 的。可用率因此把重试的代价算进去了，而重试率是更早的预警。
- `occult_pot_upstream_ready` 只反映我方条件（文档坐标核对过、凭据没过期），不反映腾讯文档是否可达：对方整体挂掉时它仍然是 1。
- 凭据到期时间是 0 时表示**未知**，不是"已过期"（真实到期时刻一定是正数）。面板里用 `> 0` 过滤。
- nginx 的计数是**全局**的：放在 8080 的监控监听上，统计的仍然是 nginx 收到的全部请求，包括 80 端口上的 API 流量、扫描流量和抓取本身。

## 指标清单

### 网页 API

- `occult_pot_http_requests_total`（counter，标签 `method`、`route`、`status`）：接口被调用了多少次、结果分布如何。响应结束时加一；`/metrics` 自身不计数，被限流、被拒、404 这些短路回答同样计入。
- `occult_pot_http_request_duration_seconds`（histogram，标签 `method`、`route`，桶 0.01、0.05、0.1、0.25、0.5、1、2、5、10 秒）：接口的快慢。同一处在响应结束时记录耗时；桶铺到 10 秒是因为写入要等上游。

### 腾讯文档上游

- `occult_pot_upstream_requests_total`（counter，标签 `operation`、`result`）：上游可用情况的主指标。每次尝试结束时记一次；`result` 是 `ok` 或错误码（`ERR_UPSTREAM_BAD_REQUEST`、`ERR_UPSTREAM_AUTH_FAILED`、`ERR_UPSTREAM_RATE_LIMITED`、`ERR_UPSTREAM_FAILED`）。`operation` 取值是 `getRecords`、`addRecords`、`deleteRecords`、`getSheet`、`userinfo`、`refreshToken`。
- `occult_pot_upstream_request_duration_seconds`（histogram，标签 `operation`、`result`，桶 0.05 到 30 秒）：上游调用的耗时，含在出站队列里等待的时间。它变慢可能是上游慢，也可能是自己被限流后排队。
- `occult_pot_upstream_retries_total`（counter，标签 `operation`）：决定重试的次数。它比可用率先动，是上游开始抖动的信号。
- `occult_pot_upstream_ready`（gauge，抓取时现算）：1 表示坐标已核对且凭据未过期。不访问腾讯文档。
- `occult_pot_credential_expires_at_timestamp_seconds`（gauge，抓取时现算）：凭据到期时刻的 Unix 时间戳，0 表示未知。用 `- time()` 得到剩余秒数，可以提前安排轮换。

### 进程与运行时

由客户端库的默认集合产出，抓取时读当前值：

- `occult_pot_process_cpu_seconds_total`：进程累计 CPU 时间，`rate()` 后是核数占用。
- `occult_pot_process_resident_memory_bytes`：RSS，容器内存的主要来源；`occult_pot_process_virtual_memory_bytes`、`occult_pot_process_heap_bytes` 一起看。
- `occult_pot_process_open_fds` 与 `occult_pot_process_max_fds`：文件描述符用量与上限，泄漏或打满前的预警。
- `occult_pot_process_start_time_seconds`：进程启动时刻，用来算 uptime、发现重启。
- `occult_pot_nodejs_eventloop_lag_seconds`（另有 min、max、mean、stddev 与 p50、p90、p99）与 `occult_pot_nodejs_eventloop_utilization_histogram`、`occult_pot_nodejs_eventloop_utilization_summary`：事件循环滞后与占用。Node 只有一个线程，这几组直接反映它忙不忙。
- `occult_pot_nodejs_heap_size_total_bytes` 与 `occult_pot_nodejs_heap_size_used_bytes`、`occult_pot_nodejs_heap_space_size_total_bytes{space}` 与 `used_bytes`、`available_bytes`、`occult_pot_nodejs_external_memory_bytes`：堆的分布。
- `occult_pot_nodejs_gc_duration_seconds{kind}`：GC 停顿，`kind` 区分 minor 与 major。
- `occult_pot_nodejs_active_resources` 与 `occult_pot_nodejs_active_resources_total`、`occult_pot_nodejs_active_handles` 与 `active_requests`：活跃的句柄与请求。
- `occult_pot_nodejs_version_info{version}`：运行时版本。

这里没有容器级的内存与 CPU 上限，RSS 与 CPU 都是容器内的视角；少数指标要平台支持（例如文件描述符的 `occult_pot_process_open_fds`、`occult_pot_process_max_fds` 来自 Linux 的 `/proc`）。完整清单以抓到的输出为准。

### nginx

- `nginx_connections_active`、`nginx_connections_reading`、`nginx_connections_writing`、`nginx_connections_waiting`（gauge）：当前连接数；`waiting` 是 keepalive 的空闲连接。
- `nginx_connections_accepted` 与 `nginx_connections_handled`（counter，名字里没有 `_total`）：接受的连接数与成功处理的连接数。两者之差是**因资源不足被丢弃的连接**，值得告警。
- `nginx_http_requests_total`（counter）：请求总数，含被 404 掉的扫描流量与抓取本身。

### Redis

指标名是 `redis_` 加 `INFO` 里的字段名，个别字段被改名（例如 `used_memory` 对应 `redis_memory_used_bytes`）；完整清单以抓到的输出为准。

- `redis_up`：这次读 `INFO` 是否成功。它是这套 Redis 指标的总开关，为 0 时其他指标也停了。
- `redis_memory_used_bytes` 与 `redis_memory_max_bytes`：内存用量与上限，相除是使用率。
- `redis_instantaneous_ops_per_sec`、`redis_commands_processed_total`：命令速率。
- `redis_keyspace_hits_total` 与 `redis_keyspace_misses_total`：命中率。缓存失效会让它掉下来。
- `redis_connected_clients`、`redis_db_keys{db}`：连接数与各库键数。
- `redis_expired_keys_total`、`redis_evicted_keys_total`：过期与被淘汰的键。出现淘汰说明内存紧张。
- AOF/RDB 状态类指标与 `redis_uptime_in_seconds`：持久化是否正常、实例活了多久。

### 主机

- `node_cpu_seconds_total{mode}`：CPU 时间，按模式分；用 idle 占比反算使用率。
- `node_memory_MemTotal_bytes` 与 `node_memory_MemAvailable_bytes`：内存总量与可用量。
- `node_filesystem_size_bytes` 与 `node_filesystem_avail_bytes{device,mountpoint,fstype}`：磁盘容量与剩余。查用量时过滤 `tmpfs`、`overlay` 之类的伪文件系统。
- `node_network_receive_bytes_total` 与 `node_network_transmit_bytes_total{device}`：网卡流量。
- `node_load1`、`node_load5`、`node_load15`：负载。
- `node_boot_time_seconds`、`node_time_seconds`：启动时刻与当前时间。
- `node_scrape_collector_success{collector}` 与 `node_scrape_collector_duration_seconds`：采集器自身的健康，某个采集器失败时在这里看得到。

### 目标与抓取自检

- `up`：每个 job 一条，抓取成功为 1、失败为 0。它是"这个目标是否可达"的第一手数据；120s 一次采样时单点 0 可能是抖动，看 `min_over_time(up[10m])` 更稳。
- `scrape_duration_seconds`、`scrape_samples_scraped`：这次抓取花了多久、拿到多少样本。

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

## 保留与磁盘

- 采集间隔 120s，抓取超时 30s：[`deploy/stats/prometheus/prometheus.yml`](../deploy/stats/prometheus/prometheus.yml) 的 `global`。
- 保留 60 天，容量上限 5GB：同一个文件的 `storage.tsdb.retention`。两者谁先到谁生效，容量不够时先删最旧的块，不会写坏当前数据。
- 面板与将来的告警窗口都用 10m 起步（慢变量用 1h），这是低精度的代价。

## 排错

```bash
# 配置是否合法（包括保留字段）
docker compose exec prometheus promtool check config /etc/prometheus/prometheus.yml

# 五个目标的状态；也可以在 Grafana 里用 Explore 查 up
docker compose exec prometheus wget -qO- http://localhost:9090/api/v1/targets | head -c 400

# Grafana 起来了没有、数据源有没有 provision 上
curl -s -u admin:"${password}" http://127.0.0.1:9999/api/health
curl -s -u admin:"${password}" http://127.0.0.1:9999/api/datasources
```

面板报「Unable to find datasource plugin」或 `plugin.notRegistered` 时，是 Grafana 13 的插件自动更新把自带的 Prometheus 数据源换掉、又没能重新注册：`curl -s -u admin:"${password}" 'http://127.0.0.1:9999/api/plugins?embedded=0' | grep -c '"id":"prometheus"'` 会是 0。compose 里已经用 `GF_PLUGINS_PREINSTALL_AUTO_UPDATE=false` 与 `GF_PLUGINS_PREINSTALL_DISABLED=true` 关掉了这套动作，万一还是遇到，`docker compose --profile stats up -d --force-recreate grafana` 会带着自带的插件重新起来。

- `up 0` 先分两步：`docker compose ps` 看那个容器在不在，再按上面的 `wget` 从网络内直接抓一次。
- 隧道连不上：先确认 `sshd -T | grep allowtcpforwarding` 不是 `no`，再看本地端口有没有被占用（`ExitOnForwardFailure yes` 会让它当场报错），最后确认服务端确实只监听了回环（`ss -ltnp | grep -E ':9999|:9090'`）。
- 面板里所有图都是空的：多半是 Prometheus 还没抓满一个窗口，或者 Grafana 的时间范围比 10m 还短。

## 鉴权的升级路径

现在是最简单的一种：Grafana 自带账号 + 只绑回环 + SSH 隧道。需要改变时，按下面的顺序考虑。

- **匿名只读**：`GF_AUTH_ANONYMOUS_ENABLED=true` 加 `GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer`。适合"别人只想看面板"，但任何能连上端口的人都能看，所以仍然只放在回环上。
- **反向代理 + basic auth**：在 nginx 上加 TLS 与 basic auth，Grafana 开 `auth.proxy` 并把 `GF_AUTH_PROXY_WHITELIST` 限定成代理地址——不限定的话 `X-WEBAUTH-USER` 头可以被伪造。只想少一层登录页时，也可以保留 Grafana 自带登录，让 nginx 只做 TLS。
- **接 SSO**：LDAP、SAML 或某一家 OAuth（GitHub、Google、Keycloak、Entra ID 等）。都需要一个浏览器能访问到的回调地址，所以要先解决域名，而不是先配 Grafana。
