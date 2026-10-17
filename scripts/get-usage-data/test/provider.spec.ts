import { describe, expect, it } from 'vitest';
import { deepseek } from '@/providers/deepseek';
import { isOnPage } from '@/providers/types';

const url = (raw: string): URL => new URL(raw);

describe('deepseek provider', () => {
  it('收下用量接口', () => {
    expect(deepseek.matchesRequest(url('https://platform.deepseek.com/api/v0/usage/by_api_key/amount?start=1789660800&end=1792252800&tz=28800'))).toBe(true);
    expect(deepseek.matchesRequest(url('https://platform.deepseek.com/api/v0/usage/by_api_key/cost?start=1789660800&end=1792252800&tz=28800'))).toBe(true);
  });

  it('收下账户概要', () => {
    expect(deepseek.matchesRequest(url('https://platform.deepseek.com/api/v0/users/get_user_summary'))).toBe(true);
  });

  it('放行站内其它接口与别的域名', () => {
    expect(deepseek.matchesRequest(url('https://platform.deepseek.com/api/v0/users/current'))).toBe(false);
    expect(deepseek.matchesRequest(url('https://platform.deepseek.com/api/v0/usage'))).toBe(false);
    // 账户概要按整条路径比，多一段就不算。
    expect(deepseek.matchesRequest(url('https://platform.deepseek.com/api/v0/users/get_user_summary/detail'))).toBe(false);
    expect(deepseek.matchesRequest(url('https://chat.deepseek.com/api/v0/usage/by_api_key/cost'))).toBe(false);
    expect(deepseek.matchesRequest(url('https://chat.deepseek.com/api/v0/users/get_user_summary'))).toBe(false);
  });

  it('页面路径按字面比，只容忍结尾斜杠', () => {
    expect(isOnPage(deepseek, '/usage')).toBe(true);
    expect(isOnPage(deepseek, '/usage/')).toBe(true);
    expect(isOnPage(deepseek, '/usage//')).toBe(true);
    expect(isOnPage(deepseek, '/usage/detail')).toBe(false);
    expect(isOnPage(deepseek, '/')).toBe(false);
    expect(isOnPage(deepseek, '/usage-other')).toBe(false);
  });
});
