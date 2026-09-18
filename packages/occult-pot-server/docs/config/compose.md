# 编排

# 编排

[`docker-compose.yml`](../../deploy/docker-compose.yml) 的可配置项，以及几个变量在容器之间的去向。`OPS_COMPOSE_*` 只有 compose 用得到，名字不会进入任何容器。

## OPS_ENV_PATH

- 类型：`路径`
- 默认值：`无`
- 指定一个额外的环境文件，优先级最高，并且连同它的 `.local` 兄弟一起读。只从真实环境读取，写进文件里没有用。两个测试任务就是用它选环境的；命名的文件必须存在，`.local` 可以没有。

## OPS_COMPOSE_NGINX_PORT

- 类型：`整数`
- 默认值：`29070`
- nginx 在宿主机上发布的端口，也是唯一能从公网到达的端口。故意不用 `8080` 这类会被扫描器猜的端口。

## OPS_COMPOSE_NGINX_TZ

- 类型：`IANA 时区名`
- 默认值：`无`（回落到 `OPS_SERVER_LOG_TIMEZONE`，再回落到 `UTC`）
- nginx 容器的 `TZ`。想让 nginx 的访问日志和应用日志用同一个时区，就设 `OPS_SERVER_LOG_TIMEZONE`：应用读它，compose 也把它当作这里的回落值。

## OPS_COMPOSE_GRAFANA_PORT

- 类型：`整数`
- 默认值：`9999`
- Grafana 在宿主机、容器与隧道三处一致的端口，只绑在 `127.0.0.1` 上。不用 Grafana 自己的 `3000`，因为那是应用的端口。

## OPS_COMPOSE_PROMETHEUS_PORT

- 类型：`整数`
- 默认值：`9090`
- Prometheus 的对应端口，同样只绑在 `127.0.0.1` 上。Prometheus 没有自带的鉴权，回环绑定就是它的保护。

## GF_SECURITY_ADMIN_PASSWORD

- 类型：`字符串`
- 默认值：`无（必填）`
- Grafana 管理员账号的密码，只在账号第一次创建时生效：之后改这个变量不会改掉已有密码，轮换要用界面里的「修改密码」，或者执行 `docker compose exec grafana grafana cli --homepath /usr/share/grafana admin reset-admin-password`。没配时容器拒绝启动，而不是退回 `admin`/`admin`。

## GF_SECURITY_ADMIN_USER

- 类型：`字符串`
- 默认值：`admin`
- Grafana 管理员账号的名字。

## 配置从哪来

应用按下面的顺序合并配置，靠前的覆盖靠后的：

```
原生环境变量  <  .env  <  .env.<mode>  <  .env.local  <  .env.<mode>.local  <  OPS_ENV_PATH  <  OPS_ENV_PATH.local
```

文件里的值覆盖原生环境变量，空值与未设置等价。`<mode>` 是运行模式：`rushx dev` 与直接跑源码是 `development`，构建产物是 `production`，测试是 `test`。仓库不发布 `.env`，只要它存在就会被读；`.env.development`（包目录）与 `.env.production`（交付目录 `deploy/`）是两份完整清单。

compose 与应用的读法是两件事：compose 只把 `OPS_COMPOSE_*`、以及 `OPS_SERVER_LOG_TIMEZONE` 这类被显式映射的变量拿去做插值，容器里的其它变量来自服务定义里的 `env_file`。容器里没有值文件，应用读到的是 compose 注入的环境变量。

## 值文件怎么给

两类文件，都在交付目录 `deploy/` 下：

- 容器的值：`env_file` 读 `.env.production`（清单，入库）与 `.env.production.local`（真实值，不入库），后面的覆盖前面的；服务自己的 `environment:` 再盖住两者。这一组写在 compose 的 `x-env-files` 里，需要取值的四个服务共用同一份。
- compose 的插值：只读 `.env.deploy`（清单，入库）与可选的 `.env.deploy.local`，命令是 `docker compose --env-file .env.deploy --env-file .env.deploy.local up -d --build`（`--env-file` 可以重复给、后面的覆盖前面的，缺文件会报错，所以没有 `.env.deploy.local` 时就只带前一个）。不带任何 `--env-file` 时端口与时区取 compose 里的默认值，容器变量不受影响。

两侧都只入库清单，真实值与机器相关的覆盖放各自的 `.local`。

## 被固定与跨容器的变量

- 服务定义里写死的：`OPS_SERVER_PORT`（`3000`）、`OPS_SERVER_TRUST_PROXY`（`1`）、`OPS_SERVER_REDIS_URL`（`redis://redis:6379`）。改值文件里的同名变量不起作用。
- 给其它容器的：`OPS_SERVER_LOG_TIMEZONE` 经上面的回落给 nginx 容器当 `TZ`；`OPS_SERVER_REDIS_PASSWORD` 同时给 `redis`（`--requirepass`）与 `redis-exporter`；`GF_*` 给 `grafana`。
