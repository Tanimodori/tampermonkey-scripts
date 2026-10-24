# xiv-api-provider

FFXIV 游戏数据的在线读取库。它读取 xivapi 的表、行、检索结果、版本清单与图片资源，两个 edition 分别是国际站与国服镜像。

它提供两个 edition 的客户端、读取端点、URL 构造、运行时的形状谓词，以及图标地址换算。

## 安装

在要使用它的项目目录执行：

```bash
rush add -p xiv-api-provider
```

## 最小用法

```ts
import { createXivApiClient, readRow, readRows } from 'xiv-api-provider';

const client = createXivApiClient('chinese-server', { language: 'chs' });

const row = await client.call(readRow, { sheet: 'Action', row: 16554, query: { fields: ['Name'] } });
const page = await client.call(readRows, { sheet: 'Item', query: { limit: 100 } });
```

## 文档

- [端点](docs/endpoint.md)：端点的路径、参数与答复。
- [客户端](docs/client.md)：两个 edition、语言、读取怎么走、边界在哪。
- [错误](docs/error.md)：失败的类型、错误码与消息。
- [校验](docs/validation.md)：schema 怎么划分，入参与出参各在哪一层判定。
- [工具](docs/utils.md)：图标地址换算。
