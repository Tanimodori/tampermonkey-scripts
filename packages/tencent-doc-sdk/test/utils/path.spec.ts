import { ApiError, ApiErrorCodes } from 'api-sdk-framework';
import { describe, expect, it } from 'vitest';
import { sheetParamsSchema } from '@/endpoints/record/schema';
import { fileIdParamsSchema } from '@/endpoints/sheet/schema';
import { buildPath, encodePathSegment, resolveCoordinates } from '@/utils/path';

/**
 * 本库唯一做路径插值的地方，以及一次调用实际寻址的坐标。
 *
 * 一个文档由一个并非「encodeURIComponent 留下的那种路径段」的 id 寻址：真实 id 带 `$`（`300000000$ExAmPlEfIlEiD`），转义它
 * 会得到一个上游答「文档不存在」的路径。而坐标是来自调用方配置的值，不能指望它老实待在被放进的那一段里。这两件事朝相反方向
 * 拉，所以转义是按值、在替换的那一刻做的，不是对拼好的路径做一遍：对成品做会连 `$` 一起带走，一遍不做会让一个 id 想说什么路径
 * 就说什么路径。
 */

describe('one path segment', () => {
  it('keeps the `$` and the `:` a real id carries', () => {
    expect(encodePathSegment('300000000$ExAmPlEfIlEiD')).toBe('300000000$ExAmPlEfIlEiD');
    expect(encodePathSegment('a:b$c')).toBe('a:b$c');
  });

  it('escapes what a path cannot carry', () => {
    expect(encodePathSegment('a/b')).toBe('a%2Fb');
    expect(encodePathSegment('a b')).toBe('a%20b');
    expect(encodePathSegment('a#b?c')).toBe('a%23b%3Fc');
    expect(encodePathSegment('a%b')).toBe('a%25b');
  });

  it('escapes a non-ASCII id rather than dropping it', () => {
    expect(encodePathSegment('表格')).toBe('%E8%A1%A8%E6%A0%BC');
  });
});

describe('interpolating a template', () => {
  it('addresses the sub-sheet list of one document, the `$` intact', () => {
    expect(buildPath('/openapi/smartbook/v2/files/{fileId}/sheets', { fileId: '300000000$ExAmPlEfIlEiD' })).toBe(
      '/openapi/smartbook/v2/files/300000000$ExAmPlEfIlEiD/sheets',
    );
  });

  it('fills every placeholder the template names', () => {
    expect(buildPath('/openapi/smartbook/v2/files/{fileId}/sheets/{sheetId}', { fileId: 'f', sheetId: 'tYYYYYY' })).toBe(
      '/openapi/smartbook/v2/files/f/sheets/tYYYYYY',
    );
  });

  it('escapes both ids on the way', () => {
    expect(buildPath('/openapi/smartbook/v2/files/{fileId}/sheets/{sheetId}', { fileId: 'a b', sheetId: 'c/d' })).toBe(
      '/openapi/smartbook/v2/files/a%20b/sheets/c%2Fd',
    );
  });

  it('keeps a value carrying separators inside the segment it was substituted into', () => {
    // 这个函数存在的意义，就是让这不可能发生：一个带着 `/`、`#` 或 `?` 的 id 不能开一段新路径、丢掉查询串、逃出 origin。
    // 按值编码之后，它做不到。
    expect(buildPath('/files/{fileId}/sheets', { fileId: '../../admin' })).toBe('/files/..%2F..%2Fadmin/sheets');
    expect(buildPath('/files/{fileId}/sheets', { fileId: 'a?b=c' })).toBe('/files/a%3Fb%3Dc/sheets');
    expect(buildPath('/files/{fileId}/sheets', { fileId: 'a#b' })).toBe('/files/a%23b/sheets');
  });

  it('carries a value that says it is a template, as text', () => {
    // id 里的一个 `{` 不是第二轮插值：值会被编码，模板本身才是唯一被解析的东西。
    expect(buildPath('/files/{fileId}', { fileId: '{sheetId}' })).toBe('/files/%7BsheetId%7D');
  });

  it('leaves a template with no placeholder alone', () => {
    expect(buildPath('/oauth/v2/token', { fileId: 'f', sheetId: 's' })).toBe('/oauth/v2/token');
  });

  it('names a placeholder the params do not carry, which is how a template and a schema disagree', () => {
    // `pupa` 抛错而不是替一个空段：装配段的失败被框架归成 `BAD_INPUT`，因此 `path` 里的一个笔误是一个点名占位符的错误，
    // 不是一次发往错误地址的请求。
    expect(() => buildPath('/files/{fileId}/sheets/{sheetId}', { fileId: 'f' })).toThrow(/sheetId/);
  });
});

describe('resolving the coordinates a call addresses by', () => {
  const configured = { fileId: '300000000$ExAmPlEfIlEiD', sheetId: 'tXXXXXX' };

  it('takes the configured pair when the call brings none', () => {
    expect(resolveCoordinates('getRecords', sheetParamsSchema, configured, undefined)).toEqual(configured);
  });

  it('lets a call override one half of it, which is what lets one client read a sibling sheet', () => {
    expect(resolveCoordinates('getRecords', sheetParamsSchema, configured, { sheetId: 'tYYYYYY' })).toEqual({
      fileId: '300000000$ExAmPlEfIlEiD',
      sheetId: 'tYYYYYY',
    });
  });

  it('takes a call that carries both coordinates itself', () => {
    expect(resolveCoordinates('getRecords', sheetParamsSchema, undefined, { fileId: 'f', sheetId: 's' })).toEqual({ fileId: 'f', sheetId: 's' });
  });

  it('drops what the endpoint’s own template cannot name', () => {
    // client 拿着两个坐标，每个文档调用都被递了那一对；子表列表只声明 `fileId`，只读它，多出来的那一个因此无害，
    // 而不是对一件调用方配置正确的东失败。
    expect(resolveCoordinates('getSheet', fileIdParamsSchema, configured, undefined)).toEqual({ fileId: '300000000$ExAmPlEfIlEiD' });
  });

  it('refuses a pair that is missing a coordinate, as a `BAD_INPUT` failure naming the field', () => {
    const caught = (() => {
      try {
        resolveCoordinates('getRecords', sheetParamsSchema, undefined, { fileId: 'f' });
        return undefined;
      } catch (cause) {
        return cause as ApiError;
      }
    })();

    expect(caught).toBeInstanceOf(ApiError);
    expect(caught?.errorCode).toBe(ApiErrorCodes.BAD_INPUT);
    expect(caught?.operation).toBe('getRecords');
    expect(caught?.message).toContain('getRecords');
    expect(caught?.message).toContain('sheetId');
  });

  it('refuses a coordinate that is not an id', () => {
    expect(() => resolveCoordinates('getRecords', sheetParamsSchema, configured, { fileId: '' })).toThrow(ApiError);
  });
});
