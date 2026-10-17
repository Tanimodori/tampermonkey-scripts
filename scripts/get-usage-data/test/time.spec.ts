import { describe, expect, it } from 'vitest';
import { localIso, localStamp } from '@/time';

/** 本机时区偏移写成 `+08:00` 这个样子，用来独立核对 `localIso` 的尾巴。 */
const expectedOffset = (date: Date): string => {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes < 0 ? '-' : '+';
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
};

describe('localStamp', () => {
  it('按本地时间读数拼成 yyyymmdd-hhmmss', () => {
    expect(localStamp(new Date(2026, 9, 17, 15, 4, 5))).toBe('20261017-150405');
  });

  it('个位数补零', () => {
    expect(localStamp(new Date(2026, 0, 2, 3, 4, 5))).toBe('20260102-030405');
  });
});

describe('localIso', () => {
  it('写成带本地偏移的 ISO 8601', () => {
    const date = new Date(2026, 9, 17, 15, 4, 5);
    expect(localIso(date)).toMatch(/^2026-10-17T15:04:05[+-]\d{2}:\d{2}$/);
  });

  it('偏移量与本机时区一致', () => {
    const date = new Date(2026, 9, 17, 15, 4, 5);
    expect(localIso(date).slice(-6)).toBe(expectedOffset(date));
  });

  it('月日时分秒都补零', () => {
    const date = new Date(2026, 0, 2, 3, 4, 5);
    expect(localIso(date)).toMatch(/^2026-01-02T03:04:05[+-]\d{2}:\d{2}$/);
  });
});
