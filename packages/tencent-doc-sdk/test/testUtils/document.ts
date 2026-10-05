import { createTDocClient } from '@/client';
import type { TDocClient } from '@/client';
import type { CommonRecord } from '@/endpoints/schema';
import { createTokenManager } from '@/token/manager';
import type { TokenManager } from '@/token/manager';
import { createCredentialStore } from '@/token/store';
import type { CredentialStore } from '@/token/store';
import { EXAMPLE_FILE_ID, EXAMPLE_SHEET_ID, TEST_CREDENTIAL, TEST_SECRET } from './fixtures';
import { apiOrigin, setupTencentDocsMock } from './mockUpstream';
import type { TencentDocsMock, TencentDocsMockState } from './mockUpstream';

/**
 * 一张 `TDocClient` 与一个 `TokenManager` 共用一份凭据、一起接在假上游上，给只想调端点、看文档怎么反应的测试。
 * id 与凭据是 mock 答复的示例那一套——是默认值，不是规矩：mock 什么 file id 都答，想看线上地址的用例自己传。
 *
 * 坐标交给 `createTDocClient` 而不是每次调用，这正是只有一个文档的调用方会做的事；想寻址别处的用例传自己的 `params`，
 * client 的坐标就是被它覆盖的那一份。
 */

export interface TestUpstream {
  /** 做每一次调用，落在假文档与这份 store 上。 */
  readonly api: TDocClient;
  readonly tokens: TokenManager;
  /** 两个 client 共用的凭据：token 授权往哪写、文档调用从哪读。 */
  readonly store: CredentialStore;
  readonly mock: TencentDocsMock;
  readonly state: TencentDocsMockState;
  /** client 被装配时拿到的坐标，也就是它调用路径上带的。 */
  readonly fileId: string;
  readonly sheetId: string;
  close(): Promise<void>;
}

export function testUpstream(
  options: { records?: CommonRecord[]; sheets?: Record<string, unknown>[]; userInfoOpenId?: string; fileId?: string; sheetId?: string } = {},
): TestUpstream {
  const mock = setupTencentDocsMock(options);
  const apiBase = apiOrigin();
  const params = { fileId: options.fileId ?? EXAMPLE_FILE_ID, sheetId: options.sheetId ?? EXAMPLE_SHEET_ID };
  const store = createCredentialStore(TEST_CREDENTIAL);
  const tokens = createTokenManager({ apiBase, store, clientSecret: TEST_SECRET, transport: mock.fetcher });
  const api = createTDocClient({ apiBase, store, params, transport: mock.fetcher });

  return { api, tokens, store, mock, state: mock.state, ...params, close: () => mock.close() };
}
