/**
 * 测试共享的普通值：示例文档的坐标与凭据。
 *
 * 假上游与它的答复构造在 `mockUpstream.ts`，把两个子 client 接上去的装配在 `document.ts`。
 */

/** 示例配置使用的文档坐标，mock 按它答复；用例想看到别的地址时自己传。 */
export const EXAMPLE_FILE_ID = '300000000$ExAmPlEfIlEiD';
export const EXAMPLE_SHEET_ID = 'tXXXXXX';

/** 除非用例另有交代，测试 client 用的凭据。 */
export const TEST_CREDENTIAL = {
  accessToken: 'test-access-token-value',
  clientId: 'test-client-id',
  openId: 'test-open-id',
  refreshToken: 'test-refresh-token',
};

/** 两个 token 授权共用的客户端密钥。 */
export const TEST_SECRET = 'test-client-secret';
