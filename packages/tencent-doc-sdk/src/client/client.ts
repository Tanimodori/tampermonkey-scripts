import { createCall } from 'api-sdk-framework';
import type { WebFetcher } from 'universal-fetch-type';
import type { CredentialStore } from '@/token/store';
import type { TDocEndpoint } from '@/types/sdk';
import type { DocCoordinates } from '@/utils/path';

/**
 * client 是跨调用信息的唯一持有者：收下 endpoint 与入参，把一次往返交给框架的 `createCall`，自己只把跨调用信息
 * 作为 `context` 递进去。端点知道的事情都在端点上，新增一个端点不需要动这里。
 *
 * 一次调用只有一次往返，没有重试、没有超时。想要第二次尝试的调用方自己再发一次——它知道配额已经花过一次；连接由
 * `transport` 那把 fetch 拥有，怎么等、等多久都是它的事。失败由框架按装配、发出与投影三段归类，`api.call` 抛出的
 * 因此都是 `ApiError`。
 */

/** client 的构造入参，跨调用信息都在这里，入参的键不在这里。 */
export interface TDocClientOptions {
  /** 调用发往的地址，可以是真实地址，或测试里顶替它的那一个。 */
  readonly apiBase: string;
  /** 这一次连接要出示的凭据，怎么用它由该 endpoint 的适配器决定。 */
  readonly store: CredentialStore;
  /** 文档端点默认寻址的坐标；调用自带的 `params` 覆盖它，一个 client 因此能读同文档的另一张子表。 */
  readonly params?: DocCoordinates | undefined;
  /** 唯一一条接缝，不给就走 `globalThis.fetch`。 */
  readonly transport?: WebFetcher | undefined;
}

/** `client.call` 的第二参：端点收 `undefined` 时可以整段省略。 */
export type CallArgs<In> = [undefined] extends [In] ? [input?: In] : [input: In];

/** 把 endpoint 的描述做成真实的往返；`TDocClient` 自己就是递进框架 `call` 的 `context`。 */
export interface TDocClient {
  readonly apiBase: string;
  readonly store: CredentialStore;
  readonly params: DocCoordinates | undefined;

  /** 一次调用，`In` 与 `Out` 从实参位置推断。 */
  call<In, Out>(endpoint: TDocEndpoint<In, Out>, ...input: CallArgs<In>): Promise<Out>;
}

/** 装配一份 client。 */
export function createTDocClient(options: TDocClientOptions): TDocClient {
  const call = createCall<TDocClient>({ transport: options.transport });
  const client: TDocClient = {
    apiBase: options.apiBase,
    store: options.store,
    params: options.params,
    call: <In, Out>(endpoint: TDocEndpoint<In, Out>, ...input: CallArgs<In>): Promise<Out> => call(client, endpoint, input[0] as In),
  };
  return client;
}
