# 部署与运维

交付目录是 `packages/occult-pot-server/deploy/`，它的内容就是服务器上的部署根：compose、两份值文件（compose 一份、容器一份）、日志目录、镜像的 `Dockerfile`、nginx 反向代理配置，以及三个可选件——监控组、fail2ban 的过滤与 jail、nginx 访问日志的 logrotate 规则。

```
~/occult-pot-server/
├── docker-compose.yml
├── .env.deploy                   compose 变量（端口、时区），入库
├── .env.deploy.local             本机的端口/时区覆盖，不入库
├── .env.production               容器值的清单，入库
├── .env.production.local         容器的真实值与凭据，不入库
├── Dockerfile
├── nginx/default.conf
├── stats/                        监控组的配置、面板与 ssh 片段
├── fail2ban/                     可选：filter.d 与 jail.d
├── logrotate/                    可选：nginx 访问日志的轮转规则
├── logs/                         应用与 nginx 的日志（.gitkeep 入库）
├── server/                       rush deploy 的产物
└── occult-pot-server.zip         上传用的压缩包
```

两份值文件的分工：`OPS_COMPOSE_*` 只给 compose 做插值（写进 `.env.deploy`），其余变量都是容器读的（写进 `.env.production`）。两者都只入库清单，真实值放各自的 `.local`。

## 打包（开发机）

在仓库根执行。第一条构建包，第二条生成部署产物与要上传的压缩包：

```bash
rush build --to occult-pot-server
rush deploy --scenario occult-pot-server \
  --target-folder packages/occult-pot-server/deploy/server \
  --overwrite --create-archive ../occult-pot-server.zip
```

- `--target-folder` 只能是 `deploy/server`：`--overwrite` 会清空目标目录，写成 `deploy` 会把 compose、值文件、Dockerfile 与 nginx 配置一起删掉。
- 产物是 `deploy/server/`（镜像的构建上下文）与 `deploy/occult-pot-server.zip`（上传用）。前者是 `rush deploy` 按包的 `files`（只有 `dist`）复制出来的 `packages/occult-pot-server/{dist,package.json,README.md}`，场景文件是 `common/config/rush/deploy-occult-pot-server.json`。
- 镜像构建的上下文是交付目录本身，`Dockerfile` 用 `COPY server/packages/occult-pot-server/ /app/` 对上这个布局。

## 部署与更新（服务器）

```bash
# 开发机：上传交付目录里变化的部分（zip、compose、值文件、nginx、stats、fail2ban 有变化时）
scp packages/occult-pot-server/deploy/occult-pot-server.zip ${user}@${host}:~/occult-pot-server/

# 服务器（部署根）
cd ~/occult-pot-server
rm -rf server                                    # 清掉上一版产物
unzip -oq occult-pot-server.zip -d server         # 解压新产物
sudo docker compose --env-file .env.deploy up -d --build   # 重建镜像并启动
```

- 必须先解压再构建；更新时需要 `--build`，否则会继续使用已有的镜像。
- 覆盖端口或时区时写一份 `.env.deploy.local`，命令带上两个文件（后面的覆盖前面的）：

```bash
sudo docker compose --env-file .env.deploy --env-file .env.deploy.local up -d --build
```

`--env-file` 指向不存在的文件会直接报错，所以没有 `.env.deploy.local` 时就只带前一个。它只喂 compose 的插值，不会取代服务定义里的 `env_file`——容器变量照旧来自 `.env.production` 与 `.env.production.local`。不带任何 `--env-file` 时端口与时区取 compose 里的默认值，凭据仍然生效。

- 默认对外端口是 `29070`，把 `OPS_COMPOSE_NGINX_PORT=…` 写进 `.env.deploy.local` 或 shell 即可覆盖；改端口前先在云安全组放行。变量清单见 [配置：编排](../config/compose.md)。
- 只改了 nginx 配置时：

```bash
sudo docker compose exec nginx nginx -t              # 检查配置语法
sudo docker compose exec nginx nginx -s reload       # 原地改了文件时，重新加载
sudo docker compose up -d --force-recreate nginx     # 换过文件（新 inode）时才需要
```

`nginx -s reload` 只在原地改了文件时有意义。解压 zip 或 tar 会替换掉配置文件（新的 inode），而容器的绑定挂载仍指着旧的那个，这时 reload 之后跑的还是旧配置——判据是容器里 `nginx -T | grep listen 8080` 没有输出，那就 `--force-recreate nginx`。

- 交给 `--env-file` 的值文件里若含 `$`（文档 id 就是 `300000000$…`），compose 解析它做插值时会把 `$` 后面的部分当变量并打印 `level=warning … variable is not set`。这是插值命名空间里的告警：容器拿到的值不受影响，因为 `env_file` 用 `format: raw` 读同一个文件。

### 从旧布局迁移

旧版的部署根把 compose 与 `logs/` 放在 `deploy/` 的上一级。一次性搬过来：

```bash
cd ~
sudo docker compose -f occult-pot-server/docker-compose.yml --env-file occult-pot-server/.env.production.local --profile stats down
mv occult-pot-server occult-pot-server.old
mkdir occult-pot-server
mv occult-pot-server.old/deploy/* occult-pot-server/        # 交付目录的内容成为新根（含 logs/）
mv occult-pot-server.old/deploy/.gitignore occult-pot-server/ 2>/dev/null || true
mv occult-pot-server.old/docker-compose.yml occult-pot-server/
mv occult-pot-server.old/.env.production occult-pot-server/
mv occult-pot-server.old/.env.production.local occult-pot-server/
mv occult-pot-server.old/logs/* occult-pot-server/logs/ 2>/dev/null || true
cd occult-pot-server
# 把 .env.production(.local) 里的 OPS_COMPOSE_* 四项移到 .env.deploy(.local)（值原样搬）
sudo docker compose --env-file .env.deploy up -d --build
sudo docker compose --env-file .env.deploy --profile stats up -d
# 核对无误后删除 occult-pot-server.old
```

## 对外暴露面（核对清单）

在服务器本机执行，各行的预期结果见注释：

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:29070/readyz           # 200
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:29070/api/v1/pots      # 200
curl -sS http://127.0.0.1:29070/api/v1                                           # 404，纯文本 Not Found
curl -sS http://127.0.0.1:29070/healthz                                          # 404，探针不经 nginx
curl -sS http://127.0.0.1:29070/metrics                                          # 404，指标不经 nginx
curl -sS http://127.0.0.1:29070/stub_status                                      # 404，状态页只在容器网络内
curl -sS 'http://127.0.0.1:29070/cgi-bin/luci/rpc/auth'                          # 404，纯文本
ss -ltnp | grep -E '9999|9090'                                                   # 只应看到 127.0.0.1
```

公网可达的路径与其语义见 [API 端点](../api/endpoints.md)。

## 日志

时间戳默认是 UTC。需要其他时区时，应用日志用 `.env.production.local` 里的 `OPS_SERVER_LOG_TIMEZONE`，nginx 的访问日志用 `.env.deploy.local` 里的 `OPS_COMPOSE_NGINX_TZ`，后者留空时回落到前者：

```bash
cd ~/occult-pot-server
sudo docker compose --env-file .env.deploy --env-file .env.deploy.local up -d
```

文件的落盘位置、记录字段、缓冲与轮转见 [日志](logging.md)。

## 可选：监控

监控组是 compose 里的 `stats` profile：Prometheus、Grafana 与三个 exporter。它需要 `stats/` 下的配置与面板文件，而部署 zip 里只有应用产物，所以这些文件随 compose 与 nginx 配置一起上传。

```bash
sudo docker compose --env-file .env.deploy --profile stats up -d
sudo docker compose ps        # 关注的端口只有 29070、127.0.0.1:9999、127.0.0.1:9090
```

Grafana 的管理员密码来自 `.env.production.local` 里的 `GF_SECURITY_ADMIN_PASSWORD`；为空时容器直接退出，不会退回默认密码。它只在账号第一次创建时生效，之后轮换用界面，或者：

```bash
sudo docker compose exec grafana grafana cli --homepath /usr/share/grafana admin reset-admin-password '<新密码>'
```

两个界面都只绑在服务器回环上，从本机开隧道访问：

```bash
ssh -N -L 9999:127.0.0.1:9999 -L 9090:127.0.0.1:9090 ${user}@${host}
# 之后打开 http://127.0.0.1:9999（Grafana）与 http://127.0.0.1:9090（Prometheus）
```

`stats/ssh/config.occult-pot.sample` 是同一件事的 `~/.ssh/config` 版本。端口表、指标清单与排错见 [监控](monitoring.md)。

## 可选：fail2ban

按 IP 封禁反复触发限制的客户端。它装在宿主机上，读 `logs/nginx-access.log`，把封禁规则写进宿主机的 `DOCKER-USER` 链；与容器之间只有日志目录这一处交界。安装并启用（在部署根执行）：

```bash
sudo apt-get install -y fail2ban                                    # 安装
sudo cp fail2ban/filter.d/occult-pot-nginx.conf /etc/fail2ban/filter.d/   # 安装匹配规则
sudo cp fail2ban/jail.d/occult-pot-nginx.conf   /etc/fail2ban/jail.d/     # 安装 jail 配置
sudo systemctl restart fail2ban                                     # 生效
```

jail 文件叫 `.conf`：fail2ban 把 `jail.d/*.conf` 当作分发的默认，把 `jail.d/*.local` 当作本机覆盖，并且在 `.conf` 之后解析。要改端口或日志路径时，建议新建一份 `/etc/fail2ban/jail.d/occult-pot-nginx.local` 只写要改的字段。早先装在旧名字 `occult-pot-nginx.local` 下的那份要删掉，否则它会盖住新的 `.conf`。

核对是否生效：

```bash
sudo fail2ban-regex logs/nginx-access.log occult-pot-nginx  # 用真实日志试一遍匹配规则
sudo fail2ban-client status occult-pot-nginx                # 查看 jail 状态与被封禁的地址
sudo iptables -S DOCKER-USER                                # 确认封禁规则落在 DOCKER-USER 链上
```

改动配置后执行 `sudo systemctl restart fail2ban`；在 fail2ban 1.1.0 上 `fail2ban-client reload` 会让 jail 消失。验证封禁是否正确（`203.0.113.0/24` 是 TEST-NET-3，不会是真实客户端）：

```bash
sudo fail2ban-client set occult-pot-nginx banip 203.0.113.7     # 手工封禁一个测试地址
sudo iptables -S f2b-occult-pot-nginx                            # 应出现该地址的 REJECT 规则
sudo fail2ban-client set occult-pot-nginx unbanip 203.0.113.7   # 解除封禁
```

## 可选：logrotate

轮转 `logs/nginx-access.log`（应用日志已自带轮转，在部署根执行）：

```bash
sudo cp logrotate/occult-pot-nginx /etc/logrotate.d/   # 安装轮转规则
sudo logrotate -d /etc/logrotate.d/occult-pot-nginx    # 干跑一遍，确认路径与权限
```

规则里的日志路径是占位值 `/path/to/occult-pot-server/logs/nginx-access.log`，安装前替换为实际部署目录；fail2ban 的 `logpath` 同样是占位值。
