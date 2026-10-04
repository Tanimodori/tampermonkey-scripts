import pupa from 'pupa';
import type { z } from 'zod';
import { inputRejected } from '@/error';

/**
 * 文档坐标如何成为路径：本库唯一做路径插值的地方。
 *
 * `pupa` 是模板引擎，端点因此照文档的样子写地址（`/openapi/smartbook/v2/files/{fileId}/sheets/{sheetId}`），
 * 下游不必再从碎片拼回来。编码在**替换一个值时**完成（`transform`）而不是对拼好的字符串做：`$` 与 `:` 是文档 id 自带的
 * 字符，整体编码会把它们一并带走。查询串不归这里管：它由 `URLSearchParams#set` 按自己的规则编码。
 */

/**
 * 哪个文档、哪张子表。
 *
 * 类型别名而不是接口，这样它天生带隐式索引签名，能直接当 `PathParams` 用：client 配置的坐标**就是**文档端点要填的
 * 占位符，在这里说清楚，省掉两者每次相遇时的一次断言。
 */
export type DocCoordinates = { readonly fileId: string; readonly sheetId: string };

/** 路径模板可以命名的值，键就是占位符，因此是标识符。 */
export type PathParams = Readonly<Record<string, string>>;

/** 文档坐标的一段路径，转义时不碰 id 自带的 `$` 与 `:`。 */
export function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%24/g, '$').replace(/%3A/gi, ':');
}

/**
 * 占位符换成已编码值的模板。
 *
 * `pupa` 对参数里没有的占位符抛 `MissingValueError`，模板与 schema 在名字上分歧时因此以本库自己的 `config` 失败收场，
 * 而不是发往一个人人都不想要的地址。下面的守卫正是为保住这一点：`transform` 跑在缺值检查**之前**，不先拦住
 * `undefined`，缺席的坐标会变成字面文字 `undefined` 被发出去。
 */
export function buildPath(template: string, params: PathParams): string {
  return pupa(template, params, {
    transform: ({ value }) => (value === undefined ? undefined : encodePathSegment(String(value))),
  });
}

/**
 * 一次调用实际寻址的坐标：client 配置的与调用自带的两份合并，再按端点自己的坐标 schema 校验。
 *
 * 合并后校验而不是各查各的，从前的行为就是这样：调用方可以只覆盖一半（同文档换一张子表），另一半由配置补齐；
 * 多出来的键在整对校验时被剥掉。校验不过报 `inputRejected`，点名字段。
 */
export function resolveCoordinates<S extends z.ZodType>(
  operation: string,
  schema: S,
  configured: Partial<DocCoordinates> | undefined,
  override: Partial<DocCoordinates> | undefined,
): z.output<S> {
  const parsed = schema.safeParse({ ...configured, ...override });
  if (!parsed.success) throw inputRejected(operation, parsed.error);
  return parsed.data as z.output<S>;
}
