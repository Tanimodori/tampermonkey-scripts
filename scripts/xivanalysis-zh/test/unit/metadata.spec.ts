import { describe, expect, it } from 'vitest';
import { USERSCRIPT_META } from '../../src/userscript.meta';

describe('用户脚本元数据', () => {
  it('只匹配 xivanalysis', () => {
    expect(USERSCRIPT_META.match).toBe('https://xivanalysis.com/*');
    expect(USERSCRIPT_META.include).toBe('https://xivanalysis.com/*');
  });

  it('grant 包含 GM 请求与 unsafeWindow', () => {
    expect(USERSCRIPT_META.grant).toEqual(['GM_xmlhttpRequest', 'unsafeWindow']);
  });

  it('connect 与注入时机符合预期', () => {
    expect(USERSCRIPT_META.connect).toEqual(['www.garlandtools.cn']);
    expect(USERSCRIPT_META['run-at']).toBe('document-start');
  });
});
