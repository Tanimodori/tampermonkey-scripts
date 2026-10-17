import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadJson, fileNameOf } from '@/download';
import type { Package } from '@/store';

const record = (requestUrl: string): Package => ({ requestUrl, responseTime: '2026-10-17T15:04:05+08:00', data: { ok: true } });

describe('fileNameOf', () => {
  it('按 usage-<服务商>-<时间戳>.json 起名', () => {
    expect(fileNameOf('deepseek', new Date(2026, 9, 17, 15, 4, 5))).toBe('usage-deepseek-20261017-150405.json');
  });
});

describe('downloadJson', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('把记录写成 JSON，挂上文件名交给浏览器下载', async () => {
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return 'blob:test';
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });

    downloadJson('usage-deepseek-20261017-150405.json', [record('https://platform.deepseek.com/api/v0/usage/a')]);

    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('usage-deepseek-20261017-150405.json');
    expect(clicked[0].href).toBe('blob:test');
    // 下载已经开始，链接不该留在页面上。
    expect(document.body.contains(clicked[0])).toBe(false);
    expect(blobs).toHaveLength(1);
    expect(JSON.parse(await blobs[0].text())).toEqual([
      {
        requestUrl: 'https://platform.deepseek.com/api/v0/usage/a',
        responseTime: '2026-10-17T15:04:05+08:00',
        data: { ok: true },
      },
    ]);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('空记录也写出一个合法的空数组', async () => {
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return 'blob:test';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadJson('usage-deepseek-20261017-150405.json', []);

    expect(JSON.parse(await blobs[0].text())).toEqual([]);
  });
});
