import { createApi } from '@/client';
import type { Api } from '@/client';
import { createTokenManager } from '@/token/manager';
import type { TokenManager } from '@/token/manager';
import { createCredentialStore } from '@/token/store';
import type { CredentialStore } from '@/token/store';
import type { CommonRecord } from '@/validation/types';
import { apiOrigin, EXAMPLE_FILE_ID, EXAMPLE_SHEET_ID, setupTencentDocsMock } from './mockUpstream';
import type { TencentDocsMock, TencentDocsMockState } from './mockUpstream';

export * from '@test/testUtils/fixtures/sheet';
export * from '@test/testUtils/fixtures/record';
export * from '@test/testUtils/fixtures/oauth';
export { apiOrigin, EXAMPLE_FILE_ID, EXAMPLE_SHEET_ID, setupTencentDocsMock } from './mockUpstream';
export type { MockFailure, TencentDocsMock, TencentDocsMockState } from './mockUpstream';
export type { Api } from '@/client';
export type { TokenManager } from '@/token/manager';
export type { CredentialStore } from '@/token/store';
export type { DocCoordinates } from '@/path';
export type { CommonRecord, CommonRecords, Sheet } from '@/validation/types';

/** The credential a test client is built with, unless a case says otherwise. */
const TEST_CREDENTIAL = {
  accessToken: 'test-access-token-value',
  clientId: 'test-client-id',
  openId: 'test-open-id',
  refreshToken: 'test-refresh-token',
};

export interface TestUpstream {
  /** Makes every call, over the fake document and this `store`. */
  readonly api: Api;
  readonly tokens: TokenManager;
  /** The credential the two are built on: what a token grant writes and a document call reads. */
  readonly store: CredentialStore;
  readonly mock: TencentDocsMock;
  readonly state: TencentDocsMockState;
  /** The coordinates the client was built with, which is what its call paths carry. */
  readonly fileId: string;
  readonly sheetId: string;
  close(): Promise<void>;
}

/**
 * An `Api` and a `TokenManager` sharing one credential store, both wired onto the fake upstream, for a test
 * that only wants to call the endpoints and watch what the document did. The ids and the credential are the
 * example ones the mock answers for — which is a default, not a rule: the mock answers any file id, so a
 * case that wants to see an address on the wire says so here.
 *
 * The coordinates are handed to `createApi` rather than to each call, which is what a caller with one
 * document does too. A case that wants a call addressed somewhere else passes its own `params`, and the
 * client's are what it overrides.
 */
export function testUpstream(
  options: { records?: CommonRecord[]; sheets?: Record<string, unknown>[]; userInfoOpenId?: string; fileId?: string; sheetId?: string } = {},
): TestUpstream {
  const mock = setupTencentDocsMock(options);
  const apiBase = apiOrigin();
  const params = { fileId: options.fileId ?? EXAMPLE_FILE_ID, sheetId: options.sheetId ?? EXAMPLE_SHEET_ID };
  const store = createCredentialStore(TEST_CREDENTIAL);
  const tokens = createTokenManager({ apiBase, store, clientSecret: 'test-client-secret', transport: mock.fetcher });
  const api = createApi({ apiBase, store, params, transport: mock.fetcher });

  return { api, tokens, store, mock, state: mock.state, ...params, close: () => mock.close() };
}
