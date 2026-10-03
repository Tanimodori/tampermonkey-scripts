# 一次调用只抛一种错误

原则是一条：**`api.call(...)` 抛出来的错误都是 `ApiError`**。校验库抛的、接缝抛的、投影时 `TypeError`、判定不过抛的，三段的 catch 各自递一份 init 给同一个 `wrapApiError`，链上因此没有第二种错误类。使用方只需要 `instanceof ApiError` 一个判断、`errorCode` 一个分支。

写这一个类的时候顺手定下一条：链上不认识校验库。`cause` 的类型是 `unknown`：判定失败的那个错误自己那句话被抄进 `message`，错误本身留在 `cause` 上供人去看，而 `ApiError` 的字段不引用校验库的类型。这条约束的产物侧后果见[校验装配与产物](validation-tiers.md)。

# 一个类，四个字段

```ts
export class ApiError extends Error {
  readonly errorCode: ApiErrorCode;
  operation: string | undefined;
  request: ApiRequest | undefined;
  response: ApiResponse | undefined;
  cause: unknown;
  // 这一次失败的那一句话：Error 自带的 `message`，由构造它的这一处写下。
}
```

`operation`、`request`、`response` 是这一份声明里唯一没有 `readonly` 的三个，因为构造它的那一处可能手里就没有：`getEnvelope` 与 `verifyEnvelope` 只有它读到的那一份回答，适配器没有 client，请求与调用名都在 client 手里。`errorCode` 留着 `readonly`：码是说出这次失败的那一处定的，链上不改判。

没有拆出去的是那一群数字。`status`、信封的 `code`、`Retry-After` 都不再是类上的字段：`status` 与上游给回的整份回答留在 `response` 里，业务码由 `verifyEnvelope` 写成消息里的那一句，`Retry-After` 连解析都不做——它就原样躺在 `response.headers`。每拆出来一个字段就是一处分支条件，而使用方要分支的是 `errorCode`。

类上也没有第五个装东西的袋子，也没有一个消息格式：值得说出的那几个数，由构造失败的那一处写成一句话交进 `message`。袋里的键名是不进类型的约定——一个拼错的 `code` 没有任何东西会说——而这一句话本来就只给人读，没有代码在它上面分支。`operation` 在 `ApiErrorInit` 里是可选的，正是这个理由：回答环里抛出的那一个不知道自己属于哪一次调用，那个名字等到出栈才被补上。

# 七个码，三种来源

- `BAD_INPUT`——装配环。入参判定不过，或者 `requestAdaptor` 自己拼不出来（模板没填全、`apiBase` 配错，它自己那一次 `new URL` 就拦下了）。两处都是「调用没能按被要求的样子发出」；消息里带的是判定给出的字段名，这指向调用方自己的代码。
- `NETWORK_ERROR`——发出环。无法收到服务器回应：连接失败、body 未到、到的不是 JSON，或者交出去的串根本不是一个地址、被接缝拒收。发出与读取在同一段里，所以这些都算这一码而不是各立一个；链上不替适配器预演地址判定。
- `BAD_OUTPUT`——回答环的两种读法。`getEnvelope` 读不出那层信封时抛出它，投影取不出那一段、`responseSchema.parse` 判不过时也归它：上游答对了，答的是这份契约没有描述的东西，读错的是这边。
- `UNAUTHORIZED`、`RATE_LIMIT`、`SERVER_ERROR`——`getEnvelope` 对上状态的那一张表：401/403、429、5xx。状态先说，信封里写着什么都不相干。
- `BAD_REQUEST`——`verifyEnvelope` 对上业务码的那一句：`code` 非零就是上游没答对。这张表不再细分，一个非零值一枚码，消息优先取信封自带的 `msg`、它没话可说才回落 `Invalid envelope code: 401`，要细分的人读 `response.body`。

# 包装还是放行

三段 catch 各递一份 init 给同一个 `wrapApiError`，两种东西走进两种结局。递进来的不是 `ApiError`——投影处的 `TypeError`、`responseSchema.parse` 抛的、接缝抛的——就按这一环的 init 新建一个，原来那一个留在 `cause` 上，它那句话也就是消息里的那一句。已经是 `ApiError` 的**原样出去**：`operation`、`request`、`response` 三个字段各补一次，用的是 `??=`——它自己有了的就不动，所以那四枚上游码与它写下的消息一路活着到调用方。

补而不覆盖，是因为这两个抛出者手里都没有 client：`getEnvelope` 与 `verifyEnvelope` 只知道到达的回答，调用名与请求要等出栈才拿得到。装配环里请求还没成形，那种就是 `undefined`。

# 两面：message 与 req/res

库里不打日志，可调试性全在错误携带的字段上。`message` 是给日志行与 HTTP 响应的那一面，而它说什么由构造失败的那一处决定：`getEnvelope` 写下 `HTTP 403` 或者 `Invalid envelope`，`verifyEnvelope` 写下信封自带的 `msg`（没有才回落 `Invalid envelope code: 401`），包装底层错误的那几处一个字都不写，那句话就是底层错误自己的 `message`。`errorCode` 与 `operation` 不重复进文本，它们已经是字段——一行日志里要它们，是使用方自己把这两个值拼上那一行。地址不进消息：完整地址只在 `request.url` 上，那一个带着查询串，有凭据走查询串的调用不能把它写进日志，要地址的人自己取不带查询串的那一段。回答体也不进消息：那张表留在 `response.body` 上，把它抄进消息是使用方的决定。

`request` 与 `response` 是未消化的那一面，给的是要再看一遍的人。它们不参与 `message` 的构造，所以放上输出行是调用方自己的选择，而 `request.init.headers` 里就带着这一次调用的凭据。

重试提示原样留着：库不解析 `Retry-After`，它就躺在 `response.headers` 里。等不等是使用方在调用外面决定的事——库不重试。

# 回答的读法是两个函数

`getEnvelope<T>(response)` 读信封。状态先说：`getErrorCode(response.status)` 判出 `UNAUTHORIZED`、`RATE_LIMIT`、`SERVER_ERROR` 之一就抛出，信封里写着什么都不相干。状态没说，才看 body 是不是那层带 `code` 与 `msg` 的对象，不是就抛 `BAD_OUTPUT`。它交出的是带类型的信封，调用方从此不必对 `unknown` 作可选链。

`verifyEnvelope<T>(envelope)` 判业务码：非零就是上游没答对，抛出；是零就什么都不做，调用方接着取 `data`。

两个函数都不请求、不计时、不记录、不重试，只对已经读到的那几个字节作判定。它们由每一个信封式 endpoint 的 `responseAdaptor` 调用，client 不调用它们——client 不该知道某个上游的词汇。它们只有一处定义，所以搬进适配器不是把它们复制 N 份，是把同一对函数调 N 次；两份装配共享同一对函数，选了 raw 并不会失去「这是失败还是可用回答」的区分。

信封的形状手写判定（`'code' in x && 'msg' in x`）：经过校验槽或校验库去判信封，client 与适配器就都得依赖它，无校验的那一侧就没有意义了。

# 实例

类、`wrapApiError` 与那两个读法函数同在 `src/error.ts`，`Envelope` 在 `src/types.ts`，`src/client.ts` 的三段 catch 只是各递一份 init 给它。三枚码各自的来源、覆盖与补全、上游语义留在消息与回答里的那一面，各有用例断言在 `test/with-zod.spec.ts` 与 `test/without-zod.spec.ts` 的场景矩阵里。
