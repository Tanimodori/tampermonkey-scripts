# 四个槽

一次调用是四个环节串起来的链，其中两环是「带 `parse` 的对象」、两环是函数：

```ts
/**
 * 校验调用方给的那一袋入参：交出 `In`，不通过就抛。
 *
 * 只要求 `parse` 这一个方法，因此任何带它的校验对象都直接放得进来，不需要包装。
 */
export interface RequestSchema<In> {
  parse(input: unknown): In;
}

/** 把已校验的入参造成要发的请求。入参不带位置信息，落到哪个位置、地址怎么拼，都由这里决定。 */
export type RequestAdaptor<In, Req> = (client: Api, input: In) => Req;

/** 把到达的响应造成调用方所要的 `Out`：判成失败还是可用回答、读哪一段，都在这里。 */
export type ResponseAdaptor<Out, Res> = (client: Api, response: Res) => Out;

/** 校验投影之后的出参：交出 `Out`，不通过就抛。同样是 `parse` 一个方法。 */
export interface ResponseSchema<Out> {
  parse(output: unknown): Out;
}
```

校验与搬运分成两类槽，是为了让「校验」这一件事可以整块缺席而其余不动。两个 `*Schema` 槽只承担校验：`parse` 失败一律抛，不用结果对象，并且**槽本身可以整个不写**——没有该槽就是这一环原样通过，不需要为它准备一个恒等函数。

槽要求的是形状而不是某个库：任何提供 `parse(unknown) => T` 的对象都放得进来。契约里除此之外一概不要求——`safeParse`、schema 自身的形状自省、任何标准接口约定都不在契约里，client 也读不到它们，因此整条链不会与某个校验库一同长出来。

## 入参平铺，位置归适配器

`In` 是调用方的参数本身：`{ before, limit }`。它不描述这些值要去哪儿——不是 `{ params, query, body }` 那种按位置分组的袋子。地址的占位符、查询串的键、请求体里的关键字包装，全部由 `requestAdaptor` 决定并写出来。

这条分工带来两个结果：

- 调用点上不再出现线上形状。一个把动作关键字重复一遍的上游（`{ body: { listMessages: { limit } } }` 那种）它的包装住在适配器里，调用方说的是它自己的需求：`{ limit }`。上游的形状不该传染给每一个调用点。
- 一个 endpoint 的入参可以只有一部分上线路。同一个 `limit` 既进查询串又进请求体、或者根本不出现（被适配器用来选路）都是合法的，而按位置分组的袋子做不到这件事，因为它得先假设每个键只有一个去向。

代价是 `In` 的键与线上位置之间的对应关系只在适配器那一处可读，所以「这个参数最后去了哪里」要靠读适配器或靠测试来确定，而不是靠看类型。

## 请求与响应的形状

```ts
/** 一次请求：`url` 是完整地址，base、路径与查询串都在适配器里拼完。`init` 就是发送参数本体，method、头字段、body 都在里面。 */
export interface ApiRequest {
  readonly url: string;
  readonly init: WebFetcherRequestInit;
}

/** 只读过一次的响应：body 已解析，判定与投影看的是同一份字节。 */
export interface ApiResponse {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: unknown;
}
```

地址整个由适配器拼：`client.apiBase` 是它读到的那一份 base，模板插值、手写串接、逐段编码、`new URL(路径, base)` 都可以，链上只约定它交出一个绝对地址，可以带 `?search`。由此而来的三条责任也在适配器上：进地址的每一个入参都要按段编码，含 `/`、`%`、`#` 或中文的 id 不编码就会改变地址的形状；查询串的键值要编好码，本包的拼法是 `new URL(路径, base)` 建好之后再往 `url.searchParams` 上 `set`——编码、`&` 的连接、一个键都不在时不留一个光秃秃的 `?`，这三件事就都不归适配器写；先拼串再交给 `URL` 也成立，只是那些细节要自己管。base 本身要接得稳，尾斜杠、路径前缀这些是拼的人的事。链上不补第二道判定：client 把这个串原样交给接缝，交出去的不是一个地址时，接缝拒收它，那一次失败因此归 `NETWORK_ERROR` 而不是 `BAD_INPUT`。这类 bug 的去处是审计——`test/registry.spec.ts` 对注册表里每一份 `requestAdaptor` 的产出做一次 `new URL`，坏地址在这里就红。

`ApiResponse` 之所以是视图而不是原生响应：body 只能读一次，而同一次读既给判定、又给投影，两者都住在 `responseAdaptor` 里。

# 适配器为什么收 client

两个适配器都先收 client 本身。它们需要跨调用信息，但不该靠闭包去抓：一份 endpoint 值如果抓走了 `{ apiBase, token }`，凭据与地址就固化在这份声明里，一份 client 只能服务一个身份、一个测试也无法替换它。

收 client 之后：

- endpoint 仍然是模块顶层的纯值，可共享、可遍历，可被任何一份 client 调用。
- 需要地址或凭据的适配器读 `client.apiBase`、`client.token`，读到的是这一次实际生效的那一份。
- 参数按位置收：一个想读 `response` 的适配器必须把 `client` 写在第一位，不能省掉它再收第二个。用不到就留一个下划线前缀的名字（`noUnusedParameters` 对此豁免），本包的 `src/endpoint/raw.ts` 正是这么写的。
- 报告一次调用要用的名字不在 client 上——client 不认识哪一个调用是谁。适配器与它所属的 endpoint 共享一个常量就够了：把 `operation` 的字面量写两遍，两处不一致不会由类型系统报出来。

client 递给适配器的公开面是三个成员：`apiBase`、`token`、`call`。

- `transport` 不在其中：它由 client 私有持有，只在发出去那一步用一次。适配器拿不到它，也就不能绕过接缝自己发请求。
- `call` 在其中，所以一个确实需要「先取一个 id 再查一次」的适配器可以发起嵌套调用。这是允许的能力，不是推荐的结构：一次嵌套是两个来回、两份配额，链的顺序对内部那一次同样成立。

# Endpoint

```ts
/** client 按 `In`/`Out` 两个类型参数收每一个 endpoint。 */
export interface Endpoint<In, Out> {
  readonly operation: string;

  /** 两个校验槽都可以缺席；缺席即该环节原样通过，不需要恒等函数占位。 */
  readonly requestSchema?: RequestSchema<In>;
  readonly responseSchema?: ResponseSchema<Out>;

  /** 两个搬运槽是必填的：没有它们就不成其为一次调用。 */
  readonly requestAdaptor: RequestAdaptor<In, ApiRequest>;
  readonly responseAdaptor: ResponseAdaptor<Out, ApiResponse>;
}
```

endpoint 是纯值而不是方法或类，这带来两件可做的事：整套 endpoint 可以被遍历审计——拿一份 `In` 样本加一份 client 调用 `requestAdaptor`，断言它产出的 `url` 与 `init`（`method` 对不对、该带的凭据带没带、进地址与进查询串的值有没有编好码），拿一份测量过的回答喂给 `responseAdaptor`，断言它判成失败还是取出哪一段，加上 `operation` 的唯一性与路径集合的固定；以及同一份声明能被两种装配复用。地址的拼法、动词、头字段、位置分配与回答的读法都住在适配器里，所以这类审计问的是适配器对某个入参、某份回答算出了什么，而不是 endpoint 上有没有对应的字符串字段。`Api` 的定义在 client 那一节，两个适配器引用的就是它。

基础部分只剩 `operation`：它是唯一一个不能由适配器自己产生的字段——报告一次失败时得有一个不引用地址的名字可用，而适配器要到被调用之后才知道自己属于谁，`method`、头字段与凭据的放法都没有这种需要。

把凭据的放法从声明字段移进适配器，代价要说清：原先「一个 endpoint 读起来是 `auth: 'headers'`，它就不可能不带凭据被调用」这条由类型保证的性质没有了。适配器忘记读 `client.token`，在类型上完全成立，请求会不带凭据发出去，由上游以 `UNAUTHORIZED` 回答。替代它的是审计：对整套注册表断言每一份 `init` 都带了该带的凭据，或者明确列在无需凭据的那一批里；本包的 `test/registry.spec.ts` 就是这一条。这条测试不是可选的补充，而是这类错误唯一的去处。

不存在一个能收下所有 endpoint 的擦除类型，所以不要写 `AnyEndpoint`。`In` 同时出现在协变位置（`requestSchema` 产出它）与逆变位置（`requestAdaptor` 消费它），`Endpoint<never, unknown>` 因此不收任何一个具体 endpoint：`RequestSchema<never>` 要求返回值是 `never`。擦除只能擦成 `any`，而这会丢掉整条链的类型。做法是让 `call` 自己带两个类型参数，从实参位置推断。

# 两种装配

装配的差别只在写不写那两个可选槽：不写即无判定，写即放进一个校验对象。没有第三种状态——为一个不存在的入参留一个空槽是噪音，键的存在性已经在 `In` 里说过一次。

`call` 对这一环因此只有两种行为：槽在就 `parse`，槽不在就原样交出，两侧共享的仍然是同一对适配器。校验对象从哪个模块来、放进槽时要遵守哪两条写法约束，见[校验装配与产物](validation-tiers.md)。

# 顺序

链固定为 `requestSchema` → `requestAdaptor` → `transport` → `responseAdaptor` → `responseSchema`，client 在中间只做一件事：把回答读一次。地址在交给接缝之前它什么都不判。这个顺序按最便宜的失败先付排列：入参在任何字节被装配之前判定，一个越界的 `limit` 不会变成一次请求。

一处顺序上的变化要说明：base 与凭据现在都在同一个 `requestAdaptor` 里读，谁先谁后是这个函数自己的事，链上不再有「地址先于凭据」这一层保证。一个配错了的 `apiBase` 因此有两种下场：适配器在自己的 `new URL` 上抛，那个 `TypeError` 由 client 归成 `BAD_INPUT`，一个字节都没发出去；或者它拼出一个不是地址的串交出去，那要等接缝拒收才失败，归 `NETWORK_ERROR`——请求同样没发出去，只是话说得没那么准。不在链上补这道检查，是因为地址的合法性是适配器算出的那一个 `URL` 自带的事实，client 替不了它判；这一类 bug 由注册表审计兜住。两种失败都带着「凭据已被读取」这一事实，而凭据本身不进 `message`。

**回答的读法整个住在 `responseAdaptor` 里，包括「上游答的是不是失败」。** 一个 endpoint 的回答是不是包在信封里、业务码落在哪个区间、失败要不要抛具名错误，都是「这份回答怎么读」的问题，和地址、动词、位置分配一样属于这一个调用，不属于 client。于是 endpoint 上不需要一个 `envelope` 布尔位：

- client 因此不读回答体的内容，它只负责读一次并交出 `ApiResponse`。认识上游词汇的那两个函数仍然不认识 client，调用点从 client 搬到了每一个信封式 endpoint 的适配器里。
- 两份装配共享同一个适配器，所以判定不会因为选了 raw 而消失——它不是校验，是读法。校验槽可省，读法不可省。
- `getEnvelope` 与 `verifyEnvelope` 是纯函数这一条要求不变，它们为什么必须纯、纯出来的错误长什么样，见[错误处理](error-handling.md)。

投影排在响应校验之前，带来一条写法约束：**从 `unknown` 走到那一段的每一步，要么自己判形状，要么会抛**——紧随其后的 `responseSchema` 看不见中间的任何一层。`getEnvelope<T>(response)` 就是把 `response.body` 变成 `Envelope<T>` 的那一步：形状是手写的 `in` 判定，读不出来就抛，而那个 `T` 只说取出的那一段该是什么，不保证它成立。

- 写了 `responseSchema` 时，那一段形状不符会在这里稳定成为 `BAD_OUTPUT`。
- 没写时没有判定：一条走通却取错了段的投影安静交出 `undefined`，没有任何东西会说它错——本包的 raw 一侧就是这样，`test/tiers.spec.ts` 的「只带 zod 才有的一半」把这一条断言在那里。

反过来说，让适配器自己 `body.data.messages` 直取会更短，但两种装配就不再共用同一份代码，而且校验永远看不到投影读到了什么。

# 链上只有一个 `In`

`In` 既是被校验的类型、又是喂给装配函数的类型，所以校验与改写必须是同一步：`parse` 交出的是它判定之后的值，而这个值紧接着就是装配函数的输入，链上没有第三个位置安置「改写之前的形状」。凡是让 input 与 output 分叉的校验器——补默认值、改写字段、失败兜底——都不能放进这条链，因为使用方递进来的值已经得是 output 形状，那一步改写对它不成立。

由此得出一条约束：**一个打算同时提供两种装配的 endpoint，它的两个校验槽必须 output 等于 input。** 违反时类型系统不报，差别表现为两份装配发出不同的请求字节，只对同一份入参比较两侧的 `url` 与 `init` 才看得见。

# 声明一份 endpoint

不需要声明函数。原先由它做的两件事（动词的默认值、凭据的默认放法）都进了适配器，剩下的只有一件事——把两侧类型钉住——而类型标注本身就能做到。一份 endpoint 就是 `operation` 加四个槽的对象字面量，完整写法见 [raw.ts](../src/endpoint/raw.ts)。

标注 `Endpoint<In, Out>` 是这份声明里唯一承重的部分。它把两侧类型钉在 endpoint 上，于是 `call` 的推断、raw 与 verified 之间的展开、以及「适配器交出的形状不对」都成为编译错误。不标注，`In` 与 `Out` 会从适配器自己的签名里推出来，两份装配在类型上就不再相等，`{ ...base, requestSchema }` 那种展开也不再保证 verified 与 raw 属于同一个 endpoint。

多数答案不再集中在一个默认位。动词、头字段与凭据的放法对每一个调用都是它自己的事实，写在自己的适配器里；一个 endpoint 与其余不同，读它的适配器就看出来了，不需要为它多写一行「例外」，也不需要一行来标注「这一行是例外」。
