# 部署与运维交付物

本目录存放服务器侧的文件：镜像的 `Dockerfile`、nginx 反向代理配置，以及两个可选的配置项——fail2ban 的过滤与 jail、nginx 访问日志的 logrotate 规则。`docker compose` 与 `.env*` 仍留在包目录，本机开发也会用到。

服务器上的部署根目录是 `~/occult-pot-server/`，它是包目录中除源码之外的对应物：

```
~/occult-pot-server/
├── docker-compose.yml
├── .env.production
├── .env.production.local            本机值/凭据，不入库
├── deploy/
│   ├── Dockerfile
│   ├── nginx/default.conf
│   ├── fail2ban/                    可选：filter.d 与 jail.d
│   ├── logrotate/                   可选：nginx 访问日志的轮转规则
│   ├── server/                      rush deploy 的产物
│   └── occult-pot-server.zip
└── logs/
```

## 打包（开发机）

在仓库根执行。第一条构建包，第二条生成部署产物与要上传的压缩包：

```bash
rush build --to occult-pot-server
rush deploy --scenario occult-pot-server \
  --target-folder packages/occult-pot-server/deploy/server \
  --overwrite --create-archive ../occult-pot-server.zip
```

- `--target-folder` 用 `deploy/server`；`--overwrite` 会删除目标目录里已有的内容，写成 `deploy` 会连 Dockerfile 与 nginx 配置一起删掉。
- 产物是 `deploy/server/`（镜像的构建上下文）与 `deploy/occult-pot-server.zip`（上传用）。
- 场景文件是 `common/config/rush/deploy-occult-pot-server.json`，产物白名单是 `package.json` 的 `files`。

## 部署与更新（服务器）

上传产物、解压、重建并启动容器：

```bash
# 开发机：上传压缩包（Dockerfile、nginx、compose 有变化时一并上传）
scp packages/occult-pot-server/deploy/occult-pot-server.zip ${user}@${host}:~/occult-pot-server/deploy/

# 服务器
cd ~/occult-pot-server
rm -rf deploy/server                                     # 清掉上一版产物
unzip -oq deploy/occult-pot-server.zip -d deploy/server   # 解压新产物
sudo docker compose up -d --build                         # 重建镜像并启动
```

- 必须先解压再构建；更新时需要 `--build`，否则会继续使用已有的镜像。
- 回滚：保留上一版 zip，覆盖回去重新执行上面三条命令。
- 默认对外端口是 `29070`，用 `OPS_NGINX_PORT` 覆盖；改端口前先在云安全组放行。
- 只改了 nginx 配置时，让运行中的容器重新加载：

```bash
sudo docker compose exec nginx nginx -t         # 检查配置语法
sudo docker compose exec nginx nginx -s reload  # 重新加载配置
```

## 日志

- `logs/occult-pot-server.log`：应用日志，自带轮转。
- `logs/nginx-access.log`：nginx 访问日志，供 fail2ban 使用。
- `docker compose logs`：两个容器的 stdout。

时间戳默认是 UTC。改成 GMT+8：

```bash
echo 'OPS_SERVER_LOG_TIMEZONE=Asia/Shanghai' >> ~/occult-pot-server/.env.production.local
cd ~/occult-pot-server && sudo docker compose --env-file .env.production.local up -d   # 让 nginx 容器也读到这个变量
```

字段与脱敏规则见 [日志说明](../docs/logging.md)。

## 可选：fail2ban

按 IP 封禁反复触发限制的客户端。安装并启用：

```bash
sudo apt-get install -y fail2ban                                                 # 安装
sudo cp deploy/fail2ban/filter.d/occult-pot-nginx.conf /etc/fail2ban/filter.d/    # 安装匹配规则
sudo cp deploy/fail2ban/jail.d/occult-pot-nginx.local     /etc/fail2ban/jail.d/   # 安装 jail 配置
sudo systemctl restart fail2ban                                                  # 生效
```

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

轮转 `logs/nginx-access.log`（应用日志已自带轮转）：

```bash
sudo cp deploy/logrotate/occult-pot-nginx /etc/logrotate.d/   # 安装轮转规则
sudo logrotate -d /etc/logrotate.d/occult-pot-nginx           # 干跑一遍，确认路径与权限
```

规则里的日志路径是占位值 `/path/to/occult-pot-server/logs/nginx-access.log`，安装前替换为实际部署目录；fail2ban 的 `logpath` 同样是占位值。

## 对外暴露面（核对清单）

在服务器本机执行，各行的预期结果见注释：

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:29070/readyz           # 200
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:29070/api/v1/pots      # 200
curl -sS http://127.0.0.1:29070/api/v1                                           # 404，纯文本 Not Found
curl -sS http://127.0.0.1:29070/healthz                                          # 404，探针不经 nginx
curl -sS 'http://127.0.0.1:29070/cgi-bin/luci/rpc/auth'                          # 404，纯文本
```

公网可达的路径与其语义见 [API 端点](../docs/api/endpoints.md)。
