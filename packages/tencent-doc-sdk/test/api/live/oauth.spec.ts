import { live, store, tokens } from '@test/testUtils/liveDocument';
/**
 * @module-tag live
 */
import { describe, expect, it } from 'vitest';

/**
 * The identity endpoint against a **real** Tencent Docs document, asked through the manager rather than at
 * the raw endpoint: of the three credential calls, this is the one a live run can make without changing
 * anything the suite then depends on.
 *
 * Neither grant is here. A test document's environment carries an access token but neither the client
 * secret nor a refresh token, and refreshing one token invalidates the one the suite runs on. Every
 * boundary of a grant's answer — a rotated refresh token, a missing lifetime, a `400` refusal — is
 * exercised against the mock instead, in `../mock/oauth.spec.ts`.
 */

describe.skipIf(!live)('the real document: the credential', () => {
  it('reports which user the access token belongs to', async () => {
    const info = await tokens.getUserInfo();

    expect(typeof info.openID).toBe('string');
    expect(info.openID!.length).toBeGreaterThan(0);

    // The environment may name no Open-Id and leave it to the token's own claim, which this compares.
    const held = store.get().openId;
    if (held !== undefined) expect(info.openID).toBe(held);
  });

  it('answers with the identity directly under `data`, with no section key', async () => {
    // The one endpoint whose answer the envelope's own naming rule does not apply to.
    const info = await tokens.getUserInfo();

    expect(info).not.toHaveProperty('userinfo');
    expect(info).toHaveProperty('nick');
  });
});
