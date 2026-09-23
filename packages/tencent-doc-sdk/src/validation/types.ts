import type { z } from 'zod';
import type {
  addRecordsResponseSchema,
  answerHeaderSchema,
  cellValuesSchema,
  commonRecordSchema,
  commonRecordsSchema,
  deleteRecordsResponseSchema,
  getRecordsParamsSchema,
  getRecordsResponseSchema,
  getSheetResponseSchema,
  jwtHeaderSchema,
  jwtPayloadSchema,
  recordUpdateSchema,
  recordValuesSchema,
  sheetSchema,
  tokenResponseSchema,
  updateRecordsResponseSchema,
  userInfoResponseSchema,
  userInfoSchema,
  writtenRecordSchema,
  writtenRecordsSchema,
} from './schemas';

/** The types the schemas in `schemas.ts` describe, under the upstream's own names. */

export type AnswerHeader = z.infer<typeof answerHeaderSchema>;
export type CellValues = z.infer<typeof cellValuesSchema>;
export type CommonRecord = z.infer<typeof commonRecordSchema>;
export type CommonRecords = z.infer<typeof commonRecordsSchema>;
export type WrittenRecord = z.infer<typeof writtenRecordSchema>;
export type WrittenRecords = z.infer<typeof writtenRecordsSchema>;
export type GetRecordsResponse = z.infer<typeof getRecordsResponseSchema>;
export type AddRecordsResponse = z.infer<typeof addRecordsResponseSchema>;
export type UpdateRecordsResponse = z.infer<typeof updateRecordsResponseSchema>;
export type DeleteRecordsResponse = z.infer<typeof deleteRecordsResponseSchema>;
export type Sheet = z.infer<typeof sheetSchema>;
export type GetSheetResponse = z.infer<typeof getSheetResponseSchema>;
export type UserInfo = z.infer<typeof userInfoSchema>;
export type UserInfoResponse = z.infer<typeof userInfoResponseSchema>;
export type TokenResponse = z.infer<typeof tokenResponseSchema>;
export type JwtHeader = z.infer<typeof jwtHeaderSchema>;
export type JwtPayload = z.infer<typeof jwtPayloadSchema>;

// The three a caller hands an endpoint, which are the request side of the same contract named above.

export type GetRecordsParams = z.infer<typeof getRecordsParamsSchema>;
export type RecordValues = z.infer<typeof recordValuesSchema>;
export type RecordUpdate = z.infer<typeof recordUpdateSchema>;
