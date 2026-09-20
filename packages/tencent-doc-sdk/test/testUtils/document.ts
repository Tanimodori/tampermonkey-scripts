import { createDocClient } from '@/api/docClient.js';
import type { DocClient } from '@/api/docClient.js';
import { createTokenManager } from '@/token/tokenManager.js';
import type { TokenManager } from '@/token/tokenManager.js';
import type { CommonRecord } from '@/validation/types.js';
import { apiOrigin, EXAMPLE_FILE_ID, EXAMPLE_SHEET_ID, setupTencentDocsMock } from './mockUpstream.js';
import type { TencentDocsMock, TencentDocsMockState } from './mockUpstream.js';

export * from '@test/testUtils/fixtures/sheet.js';
export * from '@test/testUtils/fixtures/record.js';
export * from '@test/testUtils/fixtures/oauth.js';
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
  /** The coordinates the client was built with, which is what its call paths carry. */
  readonly fileId: string;
  readonly sheetId: string;
  close(): Promise<void>;
}

/**
 * A `DocClient` and a `TokenManager` wired onto the fake upstream, for a test that only wants to call
 * the endpoints and watch what the document did. The ids and the credential are the example ones the
 * mock answers for — which is a default, not a rule: the mock answers any file id, so a case that wants
 * to see an address on the wire says so here.
 */
export function testUpstream(
  options: { records?: CommonRecord[]; sheets?: Record<string, unknown>[]; userInfoOpenId?: string; fileId?: string; sheetId?: string } = {},
): TestUpstream {
  const mock = setupTencentDocsMock(options);
  const apiBase = apiOrigin();
  const coordinates = { fileId: options.fileId ?? EXAMPLE_FILE_ID, sheetId: options.sheetId ?? EXAMPLE_SHEET_ID };
  const tokens = createTokenManager({ apiBase, initial: TEST_CREDENTIAL, clientSecret: 'test-client-secret', transport: mock.agent });
  const client = createDocClient({ apiBase, coordinates, tokens, transport: mock.agent });

  return { client, tokens, mock, state: mock.state, ...coordinates, close: () => mock.close() };
}
