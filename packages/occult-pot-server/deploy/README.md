# 部署与运维交付物

这个目录放的是**服务器侧**的东西：nginx 的配置、给 fail2ban 用的过滤与 jail、以及 nginx 访问日志的 logrotate 规则。构建与运行的定义（`Dockerfile`、`docker-compose.yml`、`.env*`）仍留在包目录，因为 `docker compose` 就是从那里跑的。

```
deploy/
├── nginx/default.conf              反代配置：只放行 POST/GET /api/v1/pots、GET /api/v1/pots/<id>、GET /readyz
├── fail2ban/filter.d/…             读 logs/nginx-access.log 的过滤规则
├── fail2ban/jail.d/…               对应的 jail（ban 在 DOCKER-USER 链上）
└── logrotate/occult-pot-nginx      nginx 访问日志的轮转（app 自己的日志由 rotating sink 管）
```

## 部署 / 更新

```bash
cd ~/tampermonkey-scripts && git pull
cd packages/occult-pot-server
sudo docker compose up -d --build          # 这台机器上 docker 需要 sudo
```

- 默认对外端口是 **29070**（`OPS_NGINX_PORT` 可覆盖）。切端口前先在云安全组放行新端口，确认无误后再撤掉旧端口，否则外网会失联。
- 只改了 `deploy/nginx/default.conf` 时 `up -d` 不会重建容器（配置是只读挂载），要 `sudo docker compose exec nginx nginx -t && sudo docker compose exec nginx nginx -s reload`。
- 改端口（`OPS_NGINX_PORT`）会重建 nginx 容器，配置随之重新加载。

## 日志

| 文件                         | 谁写                 | 说明                                                                                                |
| ---------------------------- | -------------------- | --------------------------------------------------------------------------------------------------- |
| `logs/occult-pot-server.log` | app（rotating sink） | 一行一条 JSON，自带轮转（`OPS_LOG_ROTATING_FILE_*`），**不要**交给 logrotate                        |
| `logs/nginx-access.log`      | nginx                | 一行一条 JSON，含 `remoteAddr`/`method`/`status`/`uri`，给 fail2ban 用；由下面的 logrotate 负责轮转 |
| `docker compose logs`        | 两个容器             | stdout 仍在，`requestId` 在 nginx 与 app 之间一致，可以对着追一次请求                               |

时区：默认都是 UTC（`@timestamp` 是 UTC，nginx 的 `time` 也是 `+00:00`）。要 GMT+8：

```bash
# app 读 env 文件里的这个变量；nginx 那一层由 compose 插值，所以同一个值要能被 --env-file 读到
echo 'OPS_SERVER_LOG_TIMEZONE=Asia/Shanghai' >> .env.production.local
sudo docker compose --env-file .env.production.local up -d
```

app 的每行会多出 `"timestampLocal":"2026-09-14T03:46:11.063+08:00"`（`@timestamp` 仍是 UTC，不被覆盖），nginx 的访问日志同样变成 `+08:00`。

## fail2ban

```bash
sudo apt-get install -y fail2ban
sudo cp deploy/fail2ban/filter.d/occult-pot-nginx.conf /etc/fail2ban/filter.d/
sudo cp deploy/fail2ban/jail.d/occult-pot-nginx.local     /etc/fail2ban/jail.d/
sudo systemctl restart fail2ban

# 先拿真实日志试一遍正则，再确认 jail 与链
sudo fail2ban-regex logs/nginx-access.log occult-pot-nginx
sudo fail2ban-client status occult-pot-nginx
sudo iptables -S DOCKER-USER
```

**为什么 ban 必须落在 `DOCKER-USER`**：Docker 发布端口靠 DNAT，数据包在 nat 表改写后走 FORWARD 路径上的 `DOCKER-USER` 链，**不经过宿主机的 INPUT 链**。fail2ban 默认的 `iptables-allports` 动作插的是 INPUT，对容器端口等于什么都没做（却会显示"已封禁"）。jail 里的 `action = iptables-allports[chain="DOCKER-USER", name=occult-pot-nginx]` 就是为此。

只封某个 IP 时也可以用 nginx 自己拦，但既然是同一个入口，交给 fail2ban 更省事；被 ban 的 IP 仍会出现在访问日志里（包的丢弃发生在 nginx 之前）。

## logrotate

```bash
sudo cp deploy/logrotate/occult-pot-nginx /etc/logrotate.d/
sudo logrotate -d /etc/logrotate.d/occult-pot-nginx   # 干跑，确认路径与权限
```

`copytruncate` 意味着不需要在 postrotate 里 `docker exec … nginx -s reopen`；代价是复制与截断之间写入的极少数几行可能丢失，对 fail2ban 的用途无所谓。路径按实际部署目录改（上面写的是本机 `/home/ubuntu/tampermonkey-scripts/...`）。

## 对外暴露面（快速核对）

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:29070/readyz          # 200，body 只有 status
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:29070/api/v1/pots     # 200
curl -sS http://127.0.0.1:29070/api/v1                                          # 404，纯文本 Not Found
curl -sS http://127.0.0.1:29070/healthz                                         # 404（探针不经 nginx）
curl -sS 'http://127.0.0.1:29070/cgi-bin/luci/rpc/auth'                         # 404，纯文本
```

`/healthz` 只有容器自己的健康检查在用（直连 app 的 3000 端口），所以公网看不到；白名单之外的任何路径都由 nginx 直接 404，不转发给 app，也不产生 app 日志。
