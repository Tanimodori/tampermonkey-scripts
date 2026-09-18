# 编排

[`docker-compose.yml`](../../docker-compose.yml) 的可配置项，以及几个变量在容器之间的去向。`OPS_COMPOSE_*` 只有 compose 用得到，名字不会进入任何容器。

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

文件里的值覆盖原生环境变量，空值与未设置等价。`<mode>` 是运行模式：`rushx dev` 与直接跑源码是 `development`，构建产物是 `production`，测试是 `test`。仓库不发布 `.env`，只要它存在就会被读；`.env.development` 与 `.env.production` 是两份完整清单。

compose 与应用的读法是两件事：compose 只把 `OPS_COMPOSE_*`、以及 `OPS_SERVER_LOG_TIMEZONE` 这类被显式映射的变量拿去做插值，容器里的其它变量来自服务定义里的 `env_file`。

## 值文件怎么给

- 生产默认用 `.env.production.local` 放真实值与覆盖，命令是 `docker compose --env-file .env.production.local up -d --build`：`--env-file` 会取代自动加载的 `.env`，可以重复给、后面的文件覆盖前面的，所以端口与时区也可以写在这份文件里。
- 也可以把值放进部署目录的 `.env`：compose 会自动加载它做插值，容器也读它（它是 `env_file` 里的第二项，比交付的清单高、比两份 `.local` 低），此时端口与时区不需要 `--env-file`。两种写法选一种即可；不带任何 `--env-file` 时，端口与时区取 compose 里的默认值。
- 服务定义里的 `env_file` 顺序是 `.env.production` → `.env` → `.env.local` → `.env.production.local`：交付的清单在最下，部署自己的 `.env` 次之，本机与部署的 `.local` 覆盖在最上，后面的覆盖前面的；服务自己的 `environment:` 再盖住所有文件。这一组写在 compose 的 `x-env-files` 里，需要取值的四个服务共用同一份。

## 被固定与跨容器的变量

- 服务定义里写死的：`OPS_SERVER_PORT`（`3000`）、`OPS_SERVER_TRUST_PROXY`（`1`）、`OPS_SERVER_REDIS_URL`（`redis://redis:6379`）。改值文件里的同名变量不起作用。
- 给其它容器的：`OPS_SERVER_LOG_TIMEZONE` 经上面的回落给 nginx 容器当 `TZ`；`OPS_SERVER_REDIS_PASSWORD` 同时给 `redis`（`--requirepass`）与 `redis-exporter`；`GF_*` 给 `grafana`。
