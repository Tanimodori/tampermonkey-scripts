# 部署与运维交付物

本目录存放服务器侧的文件：镜像的 `Dockerfile`、nginx 配置、fail2ban 的过滤与 jail、以及 nginx 访问日志的 logrotate 规则。`docker compose` 与 `.env*` 仍留在包目录，本机开发也会用到。

服务器上的部署根目录是 `~/occult-pot-server/`，它是包目录中除源码之外的对应物，compose 的相对路径因此在两边一致：

```
~/occult-pot-server/                 仓库里对应
├── docker-compose.yml               packages/occult-pot-server/docker-compose.yml
├── .env.production                  packages/occult-pot-server/.env.production
├── .env.production.local            同上的 .local（本机值/凭据，不入库，只存在于服务器）
├── deploy/                          packages/occult-pot-server/deploy/
│   ├── Dockerfile                   镜像的唯一构建定义（只解包）
│   ├── nginx/default.conf           反代：只放行 POST/GET /api/v1/pots、GET /api/v1/pots/<id>、GET /readyz
│   ├── fail2ban/{filter.d,jail.d}/  读 logs/nginx-access.log 的规则与 jail（ban 在 DOCKER-USER 链上）
│   ├── logrotate/occult-pot-nginx   nginx 访问日志的轮转（app 日志由轮转 sink 处理）
│   ├── server/                      rush deploy 的产物
│   └── occult-pot-server.zip        上面那棵树的 zip，传输用
└── logs/                            app 的轮转日志 + nginx-access.log
```

## 打包（开发机）

`rush deploy` 只拷文件、不构建，因此先 build 再 deploy，两条命令都在仓库根执行：

```bash
rush build --to occult-pot-server
rush deploy --scenario occult-pot-server \
  --target-folder packages/occult-pot-server/deploy/server \
  --overwrite --create-archive ../occult-pot-server.zip
```

- 场景文件是 `common/config/rush/deploy-occult-pot-server.json`，场景名与包同名；`dependenciesToExclude: ["*"]` 让部署树里只有 `dist/` 与 `package.json`。
- `--overwrite` 会递归删除 target folder 的内容，因此 target 固定写 `deploy/server`；写成 `deploy` 会连同 Dockerfile 与 nginx 配置一起删除。
- zip 落在 `packages/occult-pot-server/deploy/occult-pot-server.zip`，`--create-archive` 的路径相对 target folder。
- 选项语义见 [`rush deploy`](https://rushjs.io/pages/commands/rush_deploy/) 与 [package.json 的 `files`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#files)。

## 部署与更新（服务器）

```bash
# 开发机：上传产物（Dockerfile、nginx、compose 有改动时一并 scp）
scp packages/occult-pot-server/deploy/occult-pot-server.zip <user>@<host>:~/occult-pot-server/deploy/

# 服务器
cd ~/occult-pot-server
rm -rf deploy/server
unzip -oq deploy/occult-pot-server.zip -d deploy/server    # 或 python3 -m zipfile -e …
sudo docker compose up -d --build                          # 该主机上 docker 需要 sudo
```

- 镜像只做两件事：把部署树 `COPY` 到 `/app`、创建日志目录。它不安装依赖、不访问网络、不读取仓库源码。Docker 不解压 zip，解压必须在构建之前。
- 不带 `--build` 时 compose 复用已有镜像，更新不会生效。
- 回滚：保留上一版 zip，覆盖回去重新解压并 `up -d --build`。
- 默认对外端口是 `29070`，由 `OPS_NGINX_PORT` 覆盖；改端口前先在云安全组放行。
- 只修改 nginx 配置时 `up -d` 不会重建容器（配置是只读挂载），需要 `sudo docker compose exec nginx nginx -t && sudo docker compose exec nginx nginx -s reload`；改端口或镜像会重建容器并自动加载新配置。

## 日志

| 文件                         | 写入方   | 说明                                                                                           |
| ---------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `logs/occult-pot-server.log` | app      | 一行一条 JSON，自带轮转，不交给 logrotate                                                      |
| `logs/nginx-access.log`      | nginx    | 一行一条 JSON，含 `remoteAddr`、`method`、`status`、`uri`，供 fail2ban 读取，由 logrotate 轮转 |
| `docker compose logs`        | 两个容器 | stdout 仍在，`requestId` 在 nginx 与 app 之间一致                                              |

时间戳默认都是 UTC。改成 GMT+8：

```bash
# app 读 env 文件里的变量；nginx 那一层由 compose 插值，因此同一个值要能被 --env-file 读到
echo 'OPS_SERVER_LOG_TIMEZONE=Asia/Shanghai' >> ~/occult-pot-server/.env.production.local
cd ~/occult-pot-server && sudo docker compose --env-file .env.production.local up -d
```

app 的每行会多出 `"timestampLocal":"2026-09-14T03:46:11.063+08:00"`（`@timestamp` 仍为 UTC），nginx 的访问日志同样变成 `+08:00`。字段与脱敏规则见 [日志说明](../docs/logging.md)。

## fail2ban

```bash
cd ~/occult-pot-server
sudo apt-get install -y fail2ban
sudo cp deploy/fail2ban/filter.d/occult-pot-nginx.conf /etc/fail2ban/filter.d/
sudo cp deploy/fail2ban/jail.d/occult-pot-nginx.local     /etc/fail2ban/jail.d/
sudo systemctl restart fail2ban

# 先用真实日志验证正则，再确认 jail 与链
sudo fail2ban-regex logs/nginx-access.log occult-pot-nginx
sudo fail2ban-client status occult-pot-nginx
sudo iptables -S DOCKER-USER
```

ban 需要落在 `DOCKER-USER` 链：Docker 发布端口使用 DNAT，数据包在 nat 表改写后走 FORWARD 路径上的 `DOCKER-USER`，不经过宿主机的 INPUT 链。fail2ban 默认的 `iptables-allports` action 插入的是 INPUT，对容器端口不起作用。jail 中的 `action = iptables-allports[chain="DOCKER-USER", name=occult-pot-nginx]` 即为此。规则写法见 [fail2ban 的 filter 与 jail](https://fail2ban.readthedocs.io/en/latest/filters.html)。

修改配置后使用 `systemctl restart fail2ban`，不使用 `fail2ban-client reload`：在 fail2ban 1.1.0 上 `reload` 之后该 jail 会从列表中消失（后续命令报 `UnknownJailException`）。重启后 `sudo fail2ban-client status` 的 `Jail list` 中应包含 `occult-pot-nginx`。

验证 ban 生效（`203.0.113.0/24` 是 TEST-NET-3，不会是真实客户端）：

```bash
sudo fail2ban-client set occult-pot-nginx banip 203.0.113.7
sudo iptables -S f2b-occult-pot-nginx     # 应出现 -s 203.0.113.7/32 -j REJECT
sudo fail2ban-client set occult-pot-nginx unbanip 203.0.113.7
```

被 ban 的 IP 仍会出现在访问日志中，数据包在 nginx 之前被丢弃。

## logrotate

```bash
cd ~/occult-pot-server
sudo cp deploy/logrotate/occult-pot-nginx /etc/logrotate.d/
sudo logrotate -d /etc/logrotate.d/occult-pot-nginx   # 干跑，确认路径与权限
```

`copytruncate` 不需要在 `postrotate` 里让 nginx 重新打开日志；代价是复制与截断之间写入的少数几行可能丢失。规则里写的是占位路径 `/path/to/occult-pot-server/logs/nginx-access.log`，安装前替换为实际部署目录（jail 的 `logpath` 同样）。指令说明见 [logrotate 手册](https://man7.org/linux/man-pages/man8/logrotate.8.html)。

## 对外暴露面（核对清单）

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:29070/readyz          # 200，body 只有 status
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:29070/api/v1/pots     # 200
curl -sS http://127.0.0.1:29070/api/v1                                          # 404，纯文本 Not Found
curl -sS http://127.0.0.1:29070/healthz                                         # 404（探针不经 nginx）
curl -sS 'http://127.0.0.1:29070/cgi-bin/luci/rpc/auth'                         # 404，纯文本
```

`/healthz` 只供容器健康检查直连，公网不可见；白名单之外的任何路径都由 nginx 直接返回 404，不转发给应用，也不产生应用日志。
