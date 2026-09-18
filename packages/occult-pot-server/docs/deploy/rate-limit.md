# 限速

入站请求按客户端 IP 限制，三层各管一段：nginx 管瞬时速率，应用管窗口内的次数，fail2ban 管反复触发限制的地址。三层都在部署侧配置，客户端看到的结果见 [API 端点](../api/endpoints.md) 的限流一节。

## 三层

|  | nginx | 应用 | fail2ban |
| --- | --- | --- | --- |
| 依据 | 请求速率，每 IP | 请求速率，每 IP 的滑动窗口 | 访问日志里状态为 `400`、`403`、`404`、`429` 的行 |
| 尺度 | 瞬时，共享内存，无记忆 | `general` 窗口 60s / 120 次，`writes` 20 次 | `findtime` 10 分钟内 `maxretry` 20 次 |
| 动作 | 当场 `429`，可按 burst 放行一小段突发 | `429` 与 `ERR_RATE_LIMITED` 信封，带 `RateLimit-*` | 写宿主机的 `DOCKER-USER` 链，按 IP 丢包 `bantime`，1h 起并逐步翻倍到 1w |
| 状态 | 进程内，重启即清 | Redis，多实例共享 | 宿主机 iptables 规则与 fail2ban 自己的库 |
| 挡不住的 | 低于速率的持续扫描 | 同左 | 瞬时洪峰 |

三者的配置位置：nginx 见 [`docker-compose.yml`](../../deploy/docker-compose.yml) 挂载的 [`nginx/default.conf`](../../deploy/nginx/default.conf)，应用见 [配置：入站限流](../config/rate-limit.md)（窗口与次数的默认值在那里，compose 不覆盖），fail2ban 见 `fail2ban/` 下的过滤与 jail 文件。

## NGINX

- `limit_req_zone $binary_remote_addr zone=occult_pot_general:10m rate=20r/s` 覆盖 `/api/v1/pots`、`/readyz` 与兜底 location，`burst=40 nodelay`。
- `limit_req_zone $occult_pot_write_key zone=occult_pot_writes:10m rate=2r/s` 只对 `POST /api/v1/pots` 生效，`burst=5 nodelay`。
- 被拒绝的请求由 `error_page 429` 交给内部的 `@rate_limited`，返回与应用一致的 `ERR_RATE_LIMITED` 信封、`Retry-After` 与 `X-Request-Id` 头，**没有** `RateLimit-*`（那三个头由应用产生）。
- 兜底 location 用 `try_files` 而不是 `return 404`：`return` 在 rewrite 阶段结束请求，`limit_req` 就轮不到，扫描者也就不会被计数。

## fail2ban

jail 与过滤规则在 `fail2ban/` 下，读 `logs/nginx-access.log`，动作是 `iptables-allports[chain="DOCKER-USER"]`：发布端口的流量走 FORWARD，只有这条链上的规则才真的丢弃。它不随容器启动，装在宿主机上（安装、核对与手工封禁的步骤见 [部署与运维](setup.md)）；与容器之间只有日志目录这一处交界。

它覆盖的是 nginx 与应有限流都放过的部分：低于速率、但一直在请求不存在路径的扫描。代价是判定有延迟（10 分钟窗口），且依赖访问日志里 `status` 字段的位置——`log_format` 把 `status` 排在 `uri` 之前，规则才不受 URI 里转义引号的影响。

## 核对

```bash
docker compose exec nginx nginx -T | grep limit_req     # 生效的限流指令
sudo fail2ban-client status occult-pot-nginx            # jail 状态与封禁数
sudo iptables -S DOCKER-USER                            # 当前封禁
```

限流是否真的生效，用超过 burst 的连续请求看响应：`for i in $(seq 1 60); do curl -s -o /dev/null -w '%{http_code} ' http://127.0.0.1:29070/readyz; done` 应在若干次 `200` 之后转为 `429`。
