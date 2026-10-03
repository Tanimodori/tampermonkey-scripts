# client 持有什么

client 是跨调用信息的唯一持有者，也是这些信息唯一被读到的地方。它把 endpoint 描述的抽象调用落到一次真实的往返上。下面这两个接口写在 `src/types.ts`，实现写在 `src/client.ts`。

```ts
export interface ApiOptions {
  /** 调用去哪里：真实地址，或测试里顶替它的那一个。 */
  readonly apiBase: string;
  /** 这一次连接要出示的凭据。每一次调用怎么用它——进哪个头字段、进不进查询串、压根不用——由该 endpoint 的适配器决定。 */
  readonly token: string;
  /** 唯一一条接缝，见下。 */
  readonly transport?: WebFetcher | undefined;
}
```

三个字段里没有一个是任何入参的替代来源：`In` 里每一个存在的键都由调用方在调用点上说，client 不认识这份入参里的任何一个键名。这是 client 能对所有 endpoint 只写一遍的前提——它一旦知道「有个键叫 `limit`，它可以被配置在这里」，`In` 就不再是纯粹的调用方类型，而每一个想少写一次的入参都会来争这个位置。

同一份 client 级信息作为第一个参数递给两个适配器：`requestAdaptor(client, input)` 与 `responseAdaptor(client, response)`，读的是 `client.apiBase` 与 `client.token`。递过去而不是让它们闭包去抓，是 endpoint 能保持模块顶层纯值的前提；`transport` 不在公开面上，适配器绕过不了接缝。

同一份跨调用信息被反复说出时的重复，由使用方自己绑：写一份 `createEndpoints(fixed)` 工厂产出已经绑好这些值的 endpoint，或在每个调用点上说出来。两者都发生在 client 之外，因为那是使用方自己的形状，不是库的。

三个字段之外不该再有第四个通用字段。动词、头字段、媒体类型、超时、重试、节流、日志都不在这里：前三项是「这一次要发什么」的一部分，写在每个 endpoint 的 `requestAdaptor` 交出的 `init` 里；后四项由拥有连接的调用方决定，理由见边界一节。

`transport` 的类型是 `universal-fetch-type` 给出的 `WebFetcher`——`(url, init) => Promise<FetcherResponse>`，即 `Fetcher<Buffer<ArrayBuffer>>`。这个接缝存在的原因是浏览器侧与 Node 侧对 `body` 的后端内存要求不一致，用类型参数固定下来，而不是在库里做适配。不给 `transport` 时调用走 `globalThis.fetch`，什么都不包。

# call

```ts
export interface Api {
  readonly apiBase: string;
  readonly token: string;
  call<In, Out>(endpoint: Endpoint<In, Out>, input: In): Promise<Out>;
}
```

client 的公开面只有一个会被使用方调用的方法。新增 endpoint 不需要动 client 一行——链上的四个槽都在 endpoint 上，client 只按固定顺序调用它们。这一条是 endpoint 能作为纯值被遍历的前提。`apiBase` 与 `token` 之所以也是公开面，是因为两个适配器要读它们。

一次调用的步骤固定如下：

1. 收下调用参数，整个原样进入下一环——client 不认识这些键，也不替任何一个键补值。
2. `requestSchema?.parse(...)` 判定整份入参；不通过就抛，此时还没有任何字节被装配。没有这一槽时原样交出，不做判定。
3. `requestAdaptor(client, input)` 造出完整地址与 `init`：动词、头字段、媒体类型、body、哪一个入参进地址、哪一个进查询串、要不要带凭据、base 怎么接，全在这一步里决定。地址合不合法也是这一步自己的事，client 不替它判。
4. `transport(request.url, request.init)` 发出。交出去的串根本不是一个地址时，接缝在这里拒收它——那是 `NETWORK_ERROR`，不是 `BAD_INPUT`。
5. 读一次响应：`status`、`headers`、`await response.json()` 组成 `ApiResponse`。第 4 步与第 5 步在同一段里：到的不是 JSON 也算 `NETWORK_ERROR`，而不是一个新的码。
6. `responseAdaptor(client, response)` 读这份回答：`getEnvelope` 交出信封（状态先说，读不出信封就抛），`verifyEnvelope` 判业务码（非零就抛），是可用回答才取出调用方所要的那一段。
7. `responseSchema?.parse(...)` 判定投影结果，交出 `Out`。没有这一槽时投影结果就是回答。

client 到这里为止没有读过回答体的内容——它只读一次并交出一个视图。上游词汇的读法住在每一个 endpoint 的适配器里，理由见适配器链的顺序一节。

顺序按最便宜的失败先付排列：调用方自己的参数最先判定，所以一个越界的 `limit` 不会变成一次请求。第 6 步只读一次 body，因为原生响应的 body 是一次性流；判定与投影必须看同一份字节，否则第二次 `json()` 直接抛。

# 错误

一次调用只抛一种错误：`ApiError`。码有哪七个、每一环是包装还是放行、`message` 与 `req`/`res` 这两面各自给谁看，都在[错误处理](error-handling.md)一处描述；链的顺序对错误的影响见下面的顺序一节。

# 边界

库不重试、不计时、不限流、不翻页，也不提供可挂入的钩子。一次 endpoint 调用是一个来回。想要第二次尝试的调用方自己发起，因为它知道一次失败的写可能已经落地、配额已经花掉。

超时随 `transport` 一起来：库从不设置 `signal`，一次调用可以挂多久是那个 fetcher 被造出来时允许多久。需要按调用给超时的，把 `signal` 声明成 `In` 的一个键——它是入参、在类型里可见、由该 endpoint 的 `requestAdaptor` 放进 `init` 的 `signal`，而不是 client 的通用字段。

扩展机制是包裹调用，不是配置库。节流、计数、日志、拒绝、重试都写在调用外面，因为那是一次调用的结果被知道的地方；测量点也不能放在 transport 之下——真实上游就把业务码藏在 HTTP `200` 后面（`packages/tencent-doc-sdk` 的 `400007` 是限流，本包的 `test/userscript.spec.ts` 用 `code: 401` 演同一个位置），只有库的错误知道它发生过。

# client 不认识校验库

client 里不能有校验库的**值**导入：一条边就把整个引擎带进所有使用方的产物，包括只需要无校验装配的那一个。链上的判定只经由 `RequestSchema` / `ResponseSchema` 的 `parse` 形状，client 不知道也不需要知道递进来的是什么——契约里没有 `safeParse`，client 也就读不到它。

同一条要求也管着回答的读法：它住在适配器里，而适配器与 client 属于同一侧。信封怎么手写判定、错误类为什么不引用校验库的类型，写在[错误处理](error-handling.md)；这一条约束的产物侧后果与失效清单写在[校验装配与产物](validation-tiers.md)。
