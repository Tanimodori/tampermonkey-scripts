/**
 * @module-tag api
 */
import { describe, expect, it } from 'vitest';
import { live, tokens } from '../testUtils/liveDocument.js';

/**
 * The credential endpoints against a **real** Tencent Docs document.
 *
 * Only the identity call is here. A refresh is not: a test document's environment carries an access
 * token but neither the client secret nor a refresh token, and refreshing one token invalidates the one
 * the suite runs on. Every boundary of the refresh answer — a rotated refresh token, a missing
 * lifetime, a `400` refusal — is exercised against the mock instead, in `../mock/token.spec.ts`.
 */

describe.skipIf(!live)('the real document: the credential', () => {
  it('reports which user the access token belongs to', async () => {
    const info = await tokens.getUserInfo(tokens.accessToken());

    expect(typeof info.openID).toBe('string');
    expect(info.openID!.length).toBeGreaterThan(0);
    if (tokens.openId() !== undefined) expect(info.openID).toBe(tokens.openId());
  });

  it('answers with the identity directly under `data`, with no section key', async () => {
    // The one endpoint whose answer the envelope's own naming rule does not apply to.
    const info = await tokens.getUserInfo(tokens.accessToken());

    expect(info).not.toHaveProperty('userinfo');
    expect(info).toHaveProperty('nick');
  });
});
