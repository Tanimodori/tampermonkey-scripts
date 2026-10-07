/**
 * 测试共用的值：地址、凭据、样本信封与取出的那一段。假服务器在 `upstream.ts`。
 */

export const BASE_URL = 'https://example.com';
export const TOKEN = 'a.fake.token';

/** 样本信封的 data 那一段，也是缺省 dataGetter 取出来的值。 */
export const PAYLOAD = { id: 'p1', text: 'hello' };

/** 正常信封。 */
export const OK_BODY = { code: 0, msg: '', data: PAYLOAD };

/** 不是 JSON 的答复体：`responseBodyReader` 换掉读法时读的就是它。 */
export const CSV_BODY = 'key,0,1\n#,Name,Icon\nint32,str,Image\n0,"",0\n';
