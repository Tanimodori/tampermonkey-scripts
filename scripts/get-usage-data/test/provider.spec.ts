import { describe, expect, it } from 'vitest';
import { clinepass } from '@/providers/clinepass';
import { commandcode } from '@/providers/commandcode';
import { deepseek } from '@/providers/deepseek';
import { qodercn } from '@/providers/qodercn';
import { isOnPage, providerOn } from '@/providers/types';
import { workbuddycn } from '@/providers/workbuddycn';

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

describe('clinepass provider', () => {
  it('收下每日用量接口', () => {
    expect(
      clinepass.matchesRequest(url('https://api.cline.bot/api/v1/users/usr-01M3VA9F850XGCF73AASJZVM9X/usages/daily?startDate=2026-10-01&endDate=2026-10-31')),
    ).toBe(true);
  });

  it('放行其它端点与别的域名', () => {
    expect(clinepass.matchesRequest(url('https://api.cline.bot/api/v1/users/usr-01M3VA9F850XGCF73AASJZVM9X/usages/monthly'))).toBe(false);
    expect(clinepass.matchesRequest(url('https://api.cline.bot/api/v1/users/usr-01M3VA9F850XGCF73AASJZVM9X/usages/daily/2026-10-01'))).toBe(false);
    expect(clinepass.matchesRequest(url('https://api.cline.bot/api/v1/user/usages/daily'))).toBe(false);
    expect(clinepass.matchesRequest(url('https://api.deepseek.com/api/v1/users/usr-01M3VA9F850XGCF73AASJZVM9X/usages/daily'))).toBe(false);
    expect(clinepass.matchesRequest(url('https://app.cline.bot/api/v1/users/usr-01M3VA9F850XGCF73AASJZVM9X/usages/daily'))).toBe(false);
  });

  it('显示页面是 /dashboard/usage', () => {
    expect(isOnPage(clinepass, '/dashboard/usage')).toBe(true);
    expect(isOnPage(clinepass, '/dashboard/usage/')).toBe(true);
    expect(isOnPage(clinepass, '/dashboard')).toBe(false);
    expect(isOnPage(clinepass, '/usage')).toBe(false);
  });

  it('按页面路径挑出对应服务商', () => {
    const providers = [deepseek, clinepass, commandcode, qodercn, workbuddycn];

    expect(providerOn(providers, '/usage')?.id).toBe('deepseek');
    expect(providerOn(providers, '/dashboard/usage')?.id).toBe('clinepass');
    expect(providerOn(providers, '/zh/Tanimodori/settings/usage')?.id).toBe('commandcode');
    expect(providerOn(providers, '/account/usage')?.id).toBe('qodercn');
    expect(providerOn(providers, '/profile/plans-usage')?.id).toBe('workbuddycn');
    expect(providerOn(providers, '/dashboard')).toBeUndefined();
  });
});

describe('commandcode provider', () => {
  it('收下按模型统计的用量接口', () => {
    expect(commandcode.matchesRequest(url('https://api.commandcode.ai/internal/usage/by-model'))).toBe(true);
    expect(commandcode.matchesRequest(url('https://api.commandcode.ai/internal/usage/by-model?startDate=2026-10-01&endDate=2026-10-31'))).toBe(true);
  });

  it('放行其它端点与别的域名', () => {
    expect(commandcode.matchesRequest(url('https://api.commandcode.ai/internal/usage/by-key'))).toBe(false);
    expect(commandcode.matchesRequest(url('https://api.commandcode.ai/internal/usage/by-model/daily'))).toBe(false);
    expect(commandcode.matchesRequest(url('https://commandcode.ai/internal/usage/by-model'))).toBe(false);
    expect(commandcode.matchesRequest(url('https://api.cline.bot/internal/usage/by-model'))).toBe(false);
  });

  it('页面路径接受语言与用户名两段，也接受省略语言', () => {
    expect(isOnPage(commandcode, '/zh/Tanimodori/settings/usage')).toBe(true);
    expect(isOnPage(commandcode, '/en/other-user/settings/usage/')).toBe(true);
    expect(isOnPage(commandcode, '/Tanimodori/settings/usage')).toBe(true);
    expect(isOnPage(commandcode, '/zh/Tanimodori/settings')).toBe(false);
    expect(isOnPage(commandcode, '/zh/Tanimodori/settings/usage/detail')).toBe(false);
    expect(isOnPage(commandcode, '/usage')).toBe(false);
  });
});

describe('qodercn provider', () => {
  it('收下积分趋势与调用明细', () => {
    expect(
      qodercn.matchesRequest(
        url(
          'https://qoder.cn/api/v1/me/cost-center/credits/daily-trend?userId=01a0b730-b6ee-7460-bb05-deaf83be306c&startTime=1791907200000&endTime=1792511999999&groupBy=all',
        ),
      ),
    ).toBe(true);
    expect(
      qodercn.matchesRequest(
        url(
          'https://qoder.cn/api/v1/me/usages/big_model_credits/histories?page=1&page_size=100&start_time=1791907200000&end_time=1792511999999&order_by=begin_at&order=-1',
        ),
      ),
    ).toBe(true);
  });

  it('放行其它端点与别的域名', () => {
    expect(qodercn.matchesRequest(url('https://qoder.cn/api/v1/me/usages'))).toBe(false);
    expect(qodercn.matchesRequest(url('https://qoder.cn/api/v1/me/usages/big_model_credits'))).toBe(false);
    expect(qodercn.matchesRequest(url('https://qoder.cn/api/v1/me/usages/big_model_credits/histories/detail'))).toBe(false);
    expect(qodercn.matchesRequest(url('https://api.qoder.cn/api/v1/me/cost-center/credits/daily-trend'))).toBe(false);
  });

  it('显示页面是 /account/usage', () => {
    expect(isOnPage(qodercn, '/account/usage')).toBe(true);
    expect(isOnPage(qodercn, '/account/usage/')).toBe(true);
    expect(isOnPage(qodercn, '/account')).toBe(false);
    expect(isOnPage(qodercn, '/account/usage/detail')).toBe(false);
  });
});

describe('workbuddycn provider', () => {
  it('收下按请求统计的用量接口', () => {
    expect(workbuddycn.matchesRequest(url('https://www.workbuddy.cn/billing/meter/get-user-request-usage'))).toBe(true);
  });

  it('放行其它端点与别的域名', () => {
    expect(workbuddycn.matchesRequest(url('https://www.workbuddy.cn/billing/meter/get-user-request-usage/detail'))).toBe(false);
    expect(workbuddycn.matchesRequest(url('https://www.workbuddy.cn/billing/meter/get-user-usage'))).toBe(false);
    expect(workbuddycn.matchesRequest(url('https://workbuddy.cn/billing/meter/get-user-request-usage'))).toBe(false);
    expect(workbuddycn.matchesRequest(url('https://www.qoder.cn/billing/meter/get-user-request-usage'))).toBe(false);
  });

  it('显示页面是 /profile/plans-usage', () => {
    expect(isOnPage(workbuddycn, '/profile/plans-usage')).toBe(true);
    expect(isOnPage(workbuddycn, '/profile/plans-usage/')).toBe(true);
    expect(isOnPage(workbuddycn, '/profile')).toBe(false);
    expect(isOnPage(workbuddycn, '/profile/plans-usage/detail')).toBe(false);
  });
});
