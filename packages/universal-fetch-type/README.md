# universal-fetch-type

本仓「可注入 transport」这条缝隙的类型定义,只有类型、没有运行时。它给出 [@apollo/utils.fetcher](https://github.com/apollographql/utils) 的那几个名字,唯一差别是把请求体的类型交给一个泛型。

## 类型

```ts
export type Fetcher<B = Buffer> = (url: string, init?: FetcherRequestInit<B>) => Promise<FetcherResponse>;

export type FetcherRequestInit<B = Buffer> = Omit<import('@apollo/utils.fetcher').FetcherRequestInit, 'body'> & { readonly body?: string | B };

export type WebFetcher = Fetcher<Buffer<ArrayBuffer>>;

export type WebFetcherRequestInit = FetcherRequestInit<Buffer<ArrayBuffer>>;

export type { FetcherHeaders, FetcherResponse };
```

`B` 取默认的 `Buffer` 时与上游同形。仓内各包用的是 `Fetcher<Buffer<ArrayBuffer>>` 这一档,本包把它命名为 `WebFetcher`,其请求体同名 `WebFetcherRequestInit`。

## 该用哪一档

上游把请求体写成 `string | Buffer`,而裸 `Buffer` 允许这块内存是共享内存。浏览器的请求体类型不接受共享内存,函数参数按逆变检查,于是浏览器自带的 `fetch` 不再能当作 `Fetcher` 使用——即使这条缝隙上从来没有请求体。把 `B` 钉到非共享内存,是让浏览器的 `fetch` 与上游的 `Fetcher` 同时可用的做法。

| `B`                       | 浏览器的 `fetch` 可交进来 | 上游的 `Fetcher` 可交进来 | 本包的请求体可递给浏览器的 `fetch` |
| ------------------------- | ------------------------- | ------------------------- | ---------------------------------- |
| `Buffer`(默认)            | 否                        | 是                        | 否                                 |
| `Uint8Array<ArrayBuffer>` | 是                        | 否                        | 是                                 |
| `Buffer<ArrayBuffer>`     | 是                        | 是                        | 是                                 |
| `any`                     | 是                        | 是                        | 是                                 |

`Buffer<ArrayBuffer>` 是唯一精确且三向都成立的写法。`Uint8Array<ArrayBuffer>` 少中间一项:`Uint8Array` 不是 `Buffer`,上游的 fetcher 接不住本包承诺递过去的内容。`any` 三向都通,代价是请求体不再被检查。

## 用法

```ts
import type { WebFetcher } from 'universal-fetch-type';

interface Options {
  readonly fetch?: WebFetcher;
}
```

`xiv-api-provider` 与 `tencent-doc-sdk` 把这六个名字原样再导出,它们的消费方从各自入口取即可,不需要直接依赖本包。别名写下的是这一档的拼法,`Buffer` 这个类型名仍在被读出的声明里,所以使用方的编译程序依旧需要 Node 的类型定义。

## 当前限制

构建与其它库一致地走 Vite,产物因此包含一个不含任何语句的 JavaScript 文件。`package.json` 不声明 `main`,`exports` 的根入口只给 `types`、不给 `default`,`files` 只列声明文件:该文件不进发布物,值导入在解析阶段就失败,而不是在一个什么都不做的模块上成功。这些包都是私有的、只经工作区被消费,这条约定目前只写在清单里。
