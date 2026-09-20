# 运行环境

[`docker-compose.yml`](../../deploy/docker-compose.yml) 定义了两组容器：始终运行的业务服务，以及 `stats` profile 里的监控组。监控组默认不启动，`docker compose up -d` 的行为与没有它时完全一样。

```
公网 ──▶ ${OPS_COMPOSE_NGINX_PORT} ──▶ nginx:80 ──▶ occult-pot-server:3000 ──▶ redis:6379
                                       （只有三个路径经它转发）

监控组，每 120s 抓一次
redis-exporter:9121 ──────▶ redis          │
nginx-exporter:9113 ──────▶ nginx:8080     ├─▶ Prometheus ──▶ Grafana
node-exporter:9100 ───────▶ 宿主 /host     │      （数据源）
occult-pot-server:3000/metrics ◀───────────┤
Prometheus 自身 ─────────────────────────◀─┘
```

应用自己报的指标只有容器网络里的人能读：nginx 不转发 `/metrics`，公网访问 `http://${host}:${OPS_COMPOSE_NGINX_PORT}/metrics` 得到的是纯文本 `404 Not Found`。打包、上线与迁移的步骤见 [部署与运维](deployment.md)。

## 业务服务

- `nginx`（`nginx:1.30-alpine`）：对外唯一发布端口的容器，也是唯一从公网可达的一层。只转发 `GET /api/v1/pots`、`POST /api/v1/pots` 与 `GET /readyz`，其余路径当场回答 `404`；另有一个不发布的 `8080` 监听，只提供监控要读的 `stub_status` 页面。转发的路径与语义见 [API 端点](../api/endpoints.md)。
- `occult-pot-server`：由交付目录的 `Dockerfile` 构建，不发布端口，网络内地址 `occult-pot-server:3000`。它等 `redis` 健康才启动，`nginx` 等它健康才启动。
- `redis`（`redis:7-alpine`）：不发布端口，网络内地址 `redis:6379`，AOF 开启，数据在命名卷 `redis-data`。

## 监控组

五个容器都属于 `stats` profile，其中只有 Prometheus 与 Grafana 发布端口，且都只在回环上。三个 exporter 是翻译进程：Prometheus 每次抓它们时，它们才去读一次真实上游。

- `prometheus`（`prom/prometheus:v3.14.0`）：抓取目标、间隔与保留策略都在 [`deploy/stats/prometheus/prometheus.yml`](../../deploy/stats/prometheus/prometheus.yml) 里。
- `grafana`（`grafana/grafana:13.2.2`）：数据源与面板都由仓库里的文件提供，见 [Grafana 面板](grafana.md)。
- `redis-exporter`（`oliver006/redis_exporter`）：读 `redis:6379` 的 `INFO`。
- `nginx-exporter`（`nginx/nginx-prometheus-exporter`）：读 `nginx:8080/stub_status`，见 [`ngx_http_stub_status_module`](https://nginx.org/en/docs/http/ngx_http_stub_status_module.html)。
- `node-exporter`（`prom/node-exporter`）：读宿主机的 `/proc` 与 `/sys`，靠 `--path.rootfs=/host` 指向只读挂载的宿主根。

## 端口

| 服务                | 容器内监听 | 网络内地址               | 主机发布                                   | 隧道   |
| ------------------- | ---------- | ------------------------ | ------------------------------------------ | ------ |
| `occult-pot-server` | 3000       | `occult-pot-server:3000` | 不发布                                     | —      |
| `nginx`             | 80         | `nginx:80`               | `${OPS_COMPOSE_NGINX_PORT}`                | —      |
| `nginx`（监控用）   | 8080       | `nginx:8080`             | 不发布                                     | —      |
| `redis`             | 6379       | `redis:6379`             | 不发布                                     | —      |
| `prometheus`        | 9090       | `prometheus:9090`        | `127.0.0.1:${OPS_COMPOSE_PROMETHEUS_PORT}` | `9090` |
| `grafana`           | 9999       | `grafana:9999`           | `127.0.0.1:${OPS_COMPOSE_GRAFANA_PORT}`    | `9999` |
| `redis-exporter`    | 9121       | `redis-exporter:9121`    | 不发布                                     | —      |
| `nginx-exporter`    | 9113       | `nginx-exporter:9113`    | 不发布                                     | —      |
| `node-exporter`     | 9100       | `node-exporter:9100`     | 不发布                                     | —      |

只有 `${OPS_COMPOSE_NGINX_PORT}` 对公网开放。监控组的两个端口绑在服务器回环上，是给隧道用的：公网扫不到，同一台机器之外的地址也连不上；Grafana 用自带账号登录。这几个端口变量的含义与取值方式见 [配置：编排](../config/compose.md)。

容器内直接读某个目标的 `/metrics`，是核对抓取是否正常最直接的办法：

```bash
docker compose exec prometheus wget -qO- http://occult-pot-server:3000/metrics | head
docker compose exec prometheus wget -qO- http://redis-exporter:9121/metrics | head
docker compose exec prometheus wget -qO- http://nginx-exporter:9113/metrics | head
docker compose exec prometheus wget -qO- http://node-exporter:9100/metrics | head
docker compose exec prometheus wget -qO- http://localhost:9090/api/v1/targets
```

## 网络与卷

- 全部容器在同一张自定义 bridge 网络 `occult-pot` 上，按服务名互相访问。这张网络不能设成 `internal: true`：应用要出站访问腾讯文档。
- 三个命名卷 `redis-data`、`prometheus-data`、`grafana-data`。监控数据放在卷里，宿主机上没有东西读它们。
- 配置文件类的绑定挂载都是只读的：nginx 的反向代理配置与 Prometheus 的配置、Grafana 的数据源与面板都来自仓库，容器重建后配置不变；`node-exporter` 以只读挂宿主的 `/:/host`。
- `./logs` 是唯一可写的共享目录，nginx 与应用都往里写；fail2ban 与 logrotate 读的就是这个目录，见 [日志](logging.md)。
- 每个容器的 stdout 由 `json-file` 驱动限量（`max-size: 10m`、`max-file: 5`），避免日志占满宿主磁盘。

## 启停

```bash
docker compose --env-file .env.deploy --profile stats up -d     # 拉起监控组（业务服务本来就在跑）
docker compose --env-file .env.deploy --profile stats down      # 停掉监控组
docker compose --env-file .env.deploy ps                        # 关注的端口只有 29070、127.0.0.1:9999、127.0.0.1:9090
```

覆盖过端口或时区时，在 `--env-file .env.deploy` 后面再加一个 `--env-file .env.deploy.local`。

Prometheus 与 Grafana 的数据放在命名卷 `prometheus-data` 与 `grafana-data` 里；`down` 不会删它们，`down -v` 会。

## 访问

[`deploy/stats/ssh/config.occult-pot.sample`](../../deploy/stats/ssh/config.occult-pot.sample) 是一份可以追加到本机 `~/.ssh/config` 的片段：把 `${host}`、`${user}` 换成部署的实际值，之后一条命令同时开两个转发。

```bash
ssh -N occult-pot          # 只做转发，不在服务器上开 shell
```

- Grafana：`http://127.0.0.1:9999`
- Prometheus：`http://127.0.0.1:9090`

本地 9999 或 9090 被占用时，改片段里 `LocalForward` 左边的本地端口。Grafana 的端口被改过的话，还要把 `GF_SERVER_ROOT_URL` 改成浏览器实际用的地址，否则登录跳转与页面里的链接会指回 `9999`。服务器侧需要允许本地转发：`sshd -T | grep allowtcpforwarding` 应为 `yes` 或 `local`。

不想开隧道时，用 Grafana 的 Explore 查 PromQL，或按下面「需要对外暴露时」把 Grafana 发布出去。

## 登录与密码

管理员密码来自 `GF_SECURITY_ADMIN_PASSWORD`（值写在 `.env.production.local`，清单在 [`.env.production`](../../deploy/.env.production)）。账号已经创建过之后再改这个变量不会改掉已有密码，轮换要用界面，或者：

```bash
docker compose exec grafana grafana cli --homepath /usr/share/grafana admin reset-admin-password '<新密码>'
```

## 需要对外暴露时

默认不暴露，要暴露就改三处：

1. `docker-compose.yml` 里 Grafana 的端口映射，把 `127.0.0.1:` 换成对外地址；
2. `GF_SERVER_ROOT_URL` 改成浏览器实际访问的地址（例如 `https://stats.example.com/`）；
3. 云安全组放行该端口，前面最好再有一层 TLS 终止，并相应设 `GF_SECURITY_COOKIE_SECURE=true`。

Prometheus 没有鉴权，默认只在回环上；要暴露它，先配 `--web.config.file` 的 `basic_auth_users`。暴露之后可以再考虑匿名只读、反向代理鉴权或接 SSO，见文末「鉴权的升级路径」。

## 保留与磁盘

- 采集间隔 120s，抓取超时 30s：[`deploy/stats/prometheus/prometheus.yml`](../../deploy/stats/prometheus/prometheus.yml) 的 `global`。
- 保留 60 天，容量上限 5GB：同一个文件的 `storage.tsdb.retention`。两者谁先到谁生效，容量不够时先删最旧的块，不会写坏当前数据，见 [Prometheus 存储](https://prometheus.io/docs/prometheus/latest/storage/)。
- 面板与将来的告警窗口都用 10m 起步（慢变量用 1h），这是低精度的代价，见 [指标](metrics.md)。

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

面板报「Unable to find datasource plugin」或 `plugin.notRegistered` 时，是 Grafana 13 的插件自动更新把自带的 Prometheus 数据源换掉、又没能重新注册：`curl -s -u admin:"${password}" 'http://127.0.0.1:9999/api/plugins?embedded=0' | grep -c '"id":"prometheus"'` 会是 0。compose 里已经用 `GF_PLUGINS_PREINSTALL_AUTO_UPDATE=false` 与 `GF_PLUGINS_PREINSTALL_DISABLED=true` 关掉了这套动作，仍然遇到时用 `docker compose --profile stats up -d --force-recreate grafana`，它会带着自带的插件重新起来。

- `up 0` 先分两步：`docker compose ps` 看那个容器在不在，再按「端口」一节的 `wget` 从网络内直接抓一次。
- 隧道连不上：先确认 `sshd -T | grep allowtcpforwarding` 不是 `no`，再看本地端口有没有被占用（`ExitOnForwardFailure yes` 会让它当场报错），最后确认服务端确实只监听了回环（`ss -ltnp | grep -E ':9999|:9090'`）。
- 面板里所有图都是空的：多半是 Prometheus 还没抓满一个窗口，或者 Grafana 的时间范围比 10m 还短。

## 鉴权的升级路径

现在是最简单的一种：Grafana 自带账号 + 只绑回环 + SSH 隧道。需要改变时，按下面的顺序考虑。

- **匿名只读**：`GF_AUTH_ANONYMOUS_ENABLED=true` 加 `GF_AUTH_ANONYMOUS_ORG_ROLE=Viewer`。适合「别人只想看面板」，但任何能连上端口的人都能看，所以仍然只放在回环上。
- **反向代理 + basic auth**：在 nginx 上加 TLS 与 basic auth，Grafana 开 `auth.proxy` 并把 `GF_AUTH_PROXY_WHITELIST` 限定成代理地址——不限定的话 `X-WEBAUTH-USER` 头可以被伪造。只想少一层登录页时，也可以保留 Grafana 自带登录，让 nginx 只做 TLS。
- **接 SSO**：LDAP、SAML 或某一家 OAuth（GitHub、Google、Keycloak、Entra ID 等）。都需要一个浏览器能访问到的回调地址，所以要先解决域名，而不是先配 Grafana。
