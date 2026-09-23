import { accessToken, refreshToken, userinfo } from './oauth';
import { addRecords, deleteRecords, getRecords, updateRecords } from './record';
import { getSheetList } from './sheet';

/**
 * Every endpoint this library knows, under the name a caller reaches it by.
 *
 * One record rather than eight loose imports because the set is closed: the upstream's smartsheet and
 * OAuth surface is what this package translates, and a caller that wants to know what can be called reads
 * this. It is also what lets a test walk every endpoint at once — `test/endpoint.spec.ts` checks each
 * `path`'s placeholders against the schema that fills them, which is the one class of mistake a template
 * can carry silently.
 */
export const endpoints = { getSheetList, getRecords, addRecords, updateRecords, deleteRecords, userinfo, accessToken, refreshToken } as const;

export { accessToken, refreshToken, userinfo } from './oauth';
export { addRecords, deleteRecords, getRecords, updateRecords } from './record';
export { getSheetList } from './sheet';
