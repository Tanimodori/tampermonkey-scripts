# 与腾讯文档通讯

服务通过腾讯文档 Open API 读写在线智能表，腾讯文档是数据的权威来源。

## 文档坐标

`fileID` 是腾讯文档 API 的编号，不是浏览器地址栏里的表格链接。两者都能从一条已授权的调用或官方工具里读到；由分享链接的 encodedID 反推 `fileID` 的方法见[文件 ID 转换](https://docs.qq.com/open/document/app/openapi/v2/file/util/converter.html)。

这些值是部署数据，只放在环境变量里：本机为交付目录的 `deploy/.env.production.local`（生产）与 `.env.test-api.local`（测试文档），容器中由 compose 注入。启动时会核对子表属于该文档，失败则拒绝启动。变量本身见 [配置：腾讯文档](../config/docs.md)。

## 凭据

访问文档需要一个 access token，以及配套的 `client_id` 与 `open_id`。凭据来自环境变量，另有一份保存在 Redis 中：环境变量中的值是初始值，若 Redis 里的 token 尚未过期则优先使用它，刷新得到的结果也会写回 Redis。`OPS_DOCS_CLIENT_SECRET` 只从环境读取，不写入 Redis。

access token 的有效期是 30 天，refresh token 是 1 年，换取与刷新都必须由后台服务发起。启动时会校验凭据，失败则拒绝启动；凭据进入有效期最后 3 天时记录一条 warning，过期后就绪状态变为 `offline`，上游调用返回鉴权失败。当前轮换凭据的方式是修改环境变量并重启：刷新的能力已经具备，但没有自动调度的定时器。

日志只记录 token 的长度、到期时刻与校验结果，不输出 token 本身，也不记录调用地址中的查询串，见 [日志](../deploy/logging.md)。

## 上游限制

腾讯文档按频率与每日次数限制调用：每个 `fileID` 每分钟 150 次，每个 `openID` 每分钟 300 次，超级会员账号每日 20000 次。服务把出站调用均匀铺开，默认每 3 秒最多 10 次；长期用量主要由缓存有效期决定。

失败后的重试次数有限：传输错误、HTTP 5xx、限流（HTTP 429 或业务码 `400007`）会重试，鉴权失败与参数错误直接返回。最终返回的错误码见 [错误处理](errors.md)；节奏与重试的变量见 [配置：出站调用](../config/upstream.md)。
