import { accessToken, refreshToken, userinfo } from './oauth';
import { addRecords, deleteRecords, getRecords, updateRecords } from './record';
import { getSheetList } from './sheet';

/**
 * 本库认识的全部端点，按调用方够到它们的名字。
 *
 * 一个记录而不是八份散落的导入，因为集合是封闭的：上游的智能表与 OAuth 面就是本包翻译的东西，想弄清能调什么就读它。
 */
export const endpoints = { getSheetList, getRecords, addRecords, updateRecords, deleteRecords, userinfo, accessToken, refreshToken } as const;

export { accessToken, refreshToken, userinfo } from './oauth';
export { addRecords, deleteRecords, getRecords, updateRecords } from './record';
export { getSheetList } from './sheet';
