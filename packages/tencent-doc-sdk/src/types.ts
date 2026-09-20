import type { z } from 'zod';
import type {
  accessTokenClaimsSchema,
  AddRecordsResponseSchema,
  answerHeaderSchema,
  cellValuesSchema,
  CommonRecordSchema,
  CommonRecordsSchema,
  DeleteRecordsResponseSchema,
  GetRecordsResponseSchema,
  GetSheetResponseSchema,
  RefreshTokenResponseSchema,
  SheetSchema,
  UserInfoResponseSchema,
  UserInfoSchema,
  UpdateRecordsResponseSchema,
  WrittenRecordsSchema,
  WrittenRecordSchema,
} from './schemas.js';

/** The types the schemas in `schemas.ts` describe, under the upstream's own names. */

export type AnswerHeader = z.infer<typeof answerHeaderSchema>;
export type CellValues = z.infer<typeof cellValuesSchema>;
export type CommonRecord = z.infer<typeof CommonRecordSchema>;
export type CommonRecords = z.infer<typeof CommonRecordsSchema>;
export type WrittenRecord = z.infer<typeof WrittenRecordSchema>;
export type WrittenRecords = z.infer<typeof WrittenRecordsSchema>;
export type GetRecordsResponse = z.infer<typeof GetRecordsResponseSchema>;
export type AddRecordsResponse = z.infer<typeof AddRecordsResponseSchema>;
export type UpdateRecordsResponse = z.infer<typeof UpdateRecordsResponseSchema>;
export type DeleteRecordsResponse = z.infer<typeof DeleteRecordsResponseSchema>;
export type Sheet = z.infer<typeof SheetSchema>;
export type GetSheetResponse = z.infer<typeof GetSheetResponseSchema>;
export type UserInfo = z.infer<typeof UserInfoSchema>;
export type UserInfoResponse = z.infer<typeof UserInfoResponseSchema>;
export type RefreshTokenResponse = z.infer<typeof RefreshTokenResponseSchema>;
export type AccessTokenClaims = z.infer<typeof accessTokenClaimsSchema>;
