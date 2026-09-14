# 部署与运维交付物

这个目录放的是**服务器侧**的东西：镜像的 `Dockerfile`、nginx 配置、fail2ban 的过滤与 jail、以及 nginx 访问日志的 logrotate 规则。`docker compose` 与 `.env*` 仍留在包目录（本机开发也要用它们）。

服务器上的部署根目录是 **`~/occult-pot-server/`** —— 它是包目录里除源码之外的对应物，compose 的相对路径因此在两边完全一致：

```
~/occult-pot-server/                 仓库里对应
├── docker-compose.yml               packages/occult-pot-server/docker-compose.yml
├── .env.production                  packages/occult-pot-server/.env.production
├── .env.production.local            同上的 .local（本机值/凭据，不入库，只存在于服务器）
├── deploy/                          packages/occult-pot-server/deploy/
│   ├── Dockerfile                   镜像的唯一构建定义（单阶段，只解包）
│   ├── nginx/default.conf           反代：只放行 POST/GET /api/v1/pots、GET /api/v1/pots/<id>、GET /readyz
│   ├── fail2ban/{filter.d,jail.d}/  读 logs/nginx-access.log 的规则与 jail（ban 在 DOCKER-USER 链上）
│   ├── logrotate/occult-pot-nginx   nginx 访问日志的轮转（app 自己的日志由 rotating sink 管）
│   ├── server/                      "rush deploy" 的产物（镜像构建上下文的一部分）
│   └── occult-pot-server.zip        上面那棵树的 zip，传输用
└── logs/                            app 的 rotating 日志 + nginx-access.log
```

## 打包（开发机）

`rush deploy` 只拷文件、不会构建，所以先 build 再 deploy；两条命令都在**仓库根**执行：

```bash
rush build --to occult-pot-server
rush deploy --scenario occult-pot-server \
  --target-folder packages/occult-pot-server/deploy/server \
  --overwrite --create-archive ../occult-pot-server.zip
```

- 场景文件是 `common/config/rush/deploy-occult-pot-server.json`（场景名与包同名）；`dependenciesToExclude: ["*"]` 让部署树里只有 `dist/` 与 `package.json`（vite 已把运行时依赖全打进 `dist/`）。
- **`--overwrite` 会递归删除 target folder 的内容**，所以 target 固定写 `deploy/server`；**绝不能**写成 `deploy`，那会删掉 Dockerfile 与 nginx 配置。
- zip 落在 `packages/occult-pot-server/deploy/occult-pot-server.zip`（`--create-archive` 的路径是相对 target folder 的）。

## 部署 / 更新（服务器）

```bash
# 开发机：把唯一的产物传过去（Dockerfile/nginx/compose 有改动时再一并 scp）
# 目标是你的部署主机：非默认 SSH 端口就用 -P <port>，账号与地址按实际填
scp packages/occult-pot-server/deploy/occult-pot-server.zip \
    <user>@<host>:~/occult-pot-server/deploy/

# 服务器
cd ~/occult-pot-server
rm -rf deploy/server
unzip -oq deploy/occult-pot-server.zip -d deploy/server    # 或 python3 -m zipfile -e …
sudo docker compose up -d --build                          # 这台机器上 docker 需要 sudo
```

- 镜像只做 `COPY server/packages/occult-pot-server/ /app/` + 建日志目录：不装 npm、不碰 apt、不需要网络、不读仓库源码。Docker 的 `ADD` **不会**解 zip，所以解压必须在构建之前。
- 不给 `--build` 时 compose 会复用现有镜像，线上还是旧产物 —— 更新必须带 `--build`。
- 回滚：留一份上一版 zip，覆盖回去重新解压 + `up -d --build`（zip 名固定）。
- 默认对外端口是 **29070**（`OPS_NGINX_PORT` 可覆盖），改端口前先在云安全组放行新端口。
- 只改了 `deploy/nginx/default.conf` 时 `up -d` 不会重建容器（配置是只读挂载），要 `sudo docker compose exec nginx nginx -t && sudo docker compose exec nginx nginx -s reload`；改端口或镜像则会重建 nginx 容器并自动加载新配置。

## 日志

| 文件                         | 谁写                 | 说明                                                                                                |
| ---------------------------- | -------------------- | --------------------------------------------------------------------------------------------------- |
| `logs/occult-pot-server.log` | app（rotating sink） | 一行一条 JSON，自带轮转（`OPS_LOG_ROTATING_FILE_*`），**不要**交给 logrotate                        |
| `logs/nginx-access.log`      | nginx                | 一行一条 JSON，含 `remoteAddr`/`method`/`status`/`uri`，给 fail2ban 用；由下面的 logrotate 负责轮转 |
| `docker compose logs`        | 两个容器             | stdout 仍在，`requestId` 在 nginx 与 app 之间一致，可以对着追一次请求                               |

时区：默认都是 UTC（`@timestamp` 是 UTC，nginx 的 `time` 也是 `+00:00`）。要 GMT+8：

```bash
# app 读 env 文件里的这个变量；nginx 那一层由 compose 插值，所以同一个值要能被 --env-file 读到
echo 'OPS_SERVER_LOG_TIMEZONE=Asia/Shanghai' >> ~/occult-pot-server/.env.production.local
cd ~/occult-pot-server && sudo docker compose --env-file .env.production.local up -d
```

app 的每行会多出 `"timestampLocal":"2026-09-14T03:46:11.063+08:00"`（`@timestamp` 仍是 UTC，不被覆盖），nginx 的访问日志同样变成 `+08:00`。

## fail2ban

```bash
cd ~/occult-pot-server
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

**改完配置用 `systemctl restart fail2ban`，不要用 `fail2ban-client reload`**：本机 fail2ban 1.1.0 上 `reload` 之后这个 jail 会从列表里消失（后续命令报 `UnknownJailException`），只有整进程重启才会稳定加载。重启后 `sudo fail2ban-client status` 的 `Jail list` 里必须能看到 `occult-pot-nginx`。

**验证 ban 真的生效**（`203.0.113.0/24` 是 TEST-NET-3，永远不会是真实客户端）：

```bash
sudo fail2ban-client set occult-pot-nginx banip 203.0.113.7
sudo iptables -S f2b-occult-pot-nginx     # 应出现 -s 203.0.113.7/32 -j REJECT
sudo fail2ban-client set occult-pot-nginx unbanip 203.0.113.7
```

只封某个 IP 时也可以用 nginx 自己拦，但既然是同一个入口，交给 fail2ban 更省事；被 ban 的 IP 仍会出现在访问日志里（包的丢弃发生在 nginx 之前）。

## logrotate

```bash
cd ~/occult-pot-server
sudo cp deploy/logrotate/occult-pot-nginx /etc/logrotate.d/
sudo logrotate -d /etc/logrotate.d/occult-pot-nginx   # 干跑，确认路径与权限
```

`copytruncate` 意味着不需要在 postrotate 里 `docker exec … nginx -s reopen`；代价是复制与截断之间写入的极少数几行可能丢失，对 fail2ban 的用途无所谓。规则里写的是占位路径 `/path/to/occult-pot-server/logs/nginx-access.log`，装之前换成实际部署目录（jail 的 `logpath` 同样）。

## 对外暴露面（快速核对）

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:29070/readyz          # 200，body 只有 status
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:29070/api/v1/pots     # 200
curl -sS http://127.0.0.1:29070/api/v1                                          # 404，纯文本 Not Found
curl -sS http://127.0.0.1:29070/healthz                                         # 404（探针不经 nginx）
curl -sS 'http://127.0.0.1:29070/cgi-bin/luci/rpc/auth'                         # 404，纯文本
```

`/healthz` 只有容器自己的健康检查在用（直连 app 的 3000 端口），所以公网看不到；白名单之外的任何路径都由 nginx 直接 404，不转发给 app，也不产生 app 日志。
