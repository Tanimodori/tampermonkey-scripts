const pad = (value: number): string => String(value).padStart(2, '0');

/** 本地时间读数，形如 `20261017-150405`，用作文件名里的时间戳。 */
export const localStamp = (date: Date): string =>
  `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` + `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;

/** ISO 8601 带本地时区偏移，形如 `2026-10-17T15:04:05+08:00`。 */
export const localIso = (date: Date): string => {
  const offset = -date.getTimezoneOffset(); // 东八区为 +480 分钟
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
};
