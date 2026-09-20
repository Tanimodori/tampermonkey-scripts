export type { ClientOptions } from './internal/context.js';
export { DEFAULT_TIMEOUT_MS, newDispatcher } from './internal/transport.js';
export { encodePathSegment } from './internal/url.js';
export { describeBody } from './internal/classify.js';
export { readAccessTokenClaims, readAccessTokenExpiresAt } from './internal/jwt.js';
export type { TencentDocsErrorCode, TencentDocsErrorOptions } from './errors.js';
export { TencentDocsError } from './errors.js';
export type { CallDescriptor, CallOutcome, UpstreamHooks } from './hooks.js';
export type { DispatchContext, DispatchGate } from './dispatch.js';
export { unpaced } from './dispatch.js';
export type { CredentialRecord, CredentialStore } from './credentials.js';
export { compact, memoryCredentialStore } from './credentials.js';
export type { DocClient, DocClientOptions, DocCoordinates, GetRecordsParams, RecordUpdate, RecordValues } from './docClient.js';
export { createDocClient } from './docClient.js';
export type { RefreshTokenInput, TokenManager, TokenManagerOptions } from './tokenManager.js';
export { createTokenManager } from './tokenManager.js';

export * from './schemas.js';
export * from './types.js';
