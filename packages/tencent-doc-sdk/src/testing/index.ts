import { createDocClient } from '../docClient.js';
import type { DocClient } from '../docClient.js';
import { createTokenManager } from '../tokenManager.js';
import type { TokenManager } from '../tokenManager.js';
import type { CommonRecord } from '../types.js';
import { apiOrigin, EXAMPLE_FILE_ID, EXAMPLE_SHEET_ID, setupTencentDocsMock } from './mockUpstream.js';
import type { TencentDocsMock, TencentDocsMockState } from './mockUpstream.js';

export * from './fixtures/file.js';
export * from './fixtures/record.js';
export * from './fixtures/token.js';
export { apiOrigin, EXAMPLE_FILE_ID, EXAMPLE_SHEET_ID, setupTencentDocsMock } from './mockUpstream.js';
export type { MockFailure, TencentDocsMock, TencentDocsMockState } from './mockUpstream.js';

/** The credential a test client is built with, unless a case says otherwise. */
const TEST_CREDENTIAL = {
  accessToken: 'test-access-token-value',
  clientId: 'test-client-id',
  openId: 'test-open-id',
  refreshToken: 'test-refresh-token',
};

export interface TestUpstream {
  readonly client: DocClient;
  readonly tokens: TokenManager;
  readonly mock: TencentDocsMock;
  readonly state: TencentDocsMockState;
  close(): Promise<void>;
}

/**
 * A `DocClient` and a `TokenManager` wired onto the fake upstream, for a test that only wants to call
 * the endpoints and watch what the document did. The ids and the credential are the example ones the
 * mock answers for.
 */
export function testUpstream(options: { records?: CommonRecord[]; sheets?: Record<string, unknown>[]; userInfoOpenId?: string } = {}): TestUpstream {
  const mock = setupTencentDocsMock(options);
  const apiBase = apiOrigin();
  const tokens = createTokenManager({ apiBase, initial: TEST_CREDENTIAL, clientSecret: 'test-client-secret', transport: mock.agent });
  const client = createDocClient({
    apiBase,
    coordinates: { fileId: EXAMPLE_FILE_ID, sheetId: EXAMPLE_SHEET_ID },
    tokens,
    transport: mock.agent,
  });

  return { client, tokens, mock, state: mock.state, close: () => mock.close() };
}
