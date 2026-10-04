import { live, store, tokens } from '@test/testUtils/liveDocument';
/**
 * @module-tag live
 */
import { describe, expect, it } from 'vitest';

/**
 * 身份端点对着**真实** Tencent Docs 文档，并且是通过 manager 问的、不是直接打裸端点：三个凭据调用里，这是 live 运行
 * 能不改变套件随后要依赖的任何东西就做掉的那一个。
 *
 * 两个授权都不在这里。测试文档的环境带着一枚访问令牌，却没有 client secret 也没有刷新令牌，而刷新一枚令牌会让套件赖以
 * 运行的那枚失效。授权答复的每个边界——轮换的刷新令牌、缺失的时限、`400` 的拒绝——都在 mock 上过一遍，在
 * `../oauth.spec.ts`。
 */

describe.skipIf(!live)('the real document: the credential', () => {
  it('reports which user the access token belongs to', async () => {
    const info = await tokens.getUserInfo();

    expect(typeof info.openID).toBe('string');
    expect(info.openID!.length).toBeGreaterThan(0);

    // 环境可能不说 Open-Id、把它留给令牌自己的声明，这里就是与它比对。
    const held = store.get().openId;
    if (held !== undefined) expect(info.openID).toBe(held);
  });

  it('answers with the identity directly under `data`, with no section key', async () => {
    // 唯一一个信封自己的命名规则不适用的端点。
    const info = await tokens.getUserInfo();

    expect(info).not.toHaveProperty('userinfo');
    expect(info).toHaveProperty('nick');
  });
});
