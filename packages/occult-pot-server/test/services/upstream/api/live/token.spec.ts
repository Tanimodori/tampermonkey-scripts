import { live, useLiveDocument } from '@test/testUtils/upstream/liveDocument.ts';
/**
 * @module-tag api
 */
import { describe, expect, it } from 'vitest';
import { getConfig } from '@/config.ts';
import { getUserInfo } from '@/services/upstream/api/token.ts';

/**
 * The credential endpoints against a **real** Tencent Docs document.
 *
 * Only the identity call is here. A refresh is not: the test document's environment carries
 * `OPS_DOCS_ACCESS_TOKEN` but neither `OPS_DOCS_CLIENT_SECRET` nor `OPS_DOCS_REFRESH_TOKEN`, and
 * refreshing one token invalidates the one the suite runs on. Every boundary of the refresh answer — a
 * rotated refresh token, a missing lifetime, a `400` refusal — is exercised against the mock instead,
 * in `../mock/token.spec.ts`.
 */

describe.skipIf(!live)('the real document: the credential', () => {
  useLiveDocument();

  it('reports which user the access token belongs to', async () => {
    const info = await getUserInfo(getConfig().docs.accessToken);

    expect(typeof info.openID).toBe('string');
    if (getConfig().docs.openId !== undefined) expect(info.openID).toBe(getConfig().docs.openId);
  });
});
