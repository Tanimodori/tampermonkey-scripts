export type { ClientOptions } from './client/context.js';
export { DEFAULT_TIMEOUT_MS, newDispatcher } from './client/transport.js';
export type { CallContext, CallRequest } from './client/request.js';
export type { CallDescriptor, CallOutcome, UpstreamHooks } from './client/hooks.js';
export type { DispatchContext, DispatchGate } from './client/dispatch.js';
export { unpaced } from './client/dispatch.js';

export type { TencentDocsErrorCode, TencentDocsErrorOptions } from './validation/errors.js';
export { TencentDocsError } from './validation/errors.js';
export { describeBody } from './validation/classify.js';
export * from './validation/schemas.js';
export * from './validation/types.js';

export { encodePathSegment } from './api/address.js';
export type { DocCoordinates, EndpointTarget } from './api/address.js';
export type { DocClient, DocClientOptions } from './api/docClient.js';
export { createDocClient } from './api/docClient.js';
export type { GetRecordsParams, RecordUpdate, RecordValues } from './api/record.js';
export type { RefreshTokenInput } from './api/oauth.js';

export type { CredentialRecord, CredentialStore } from './token/credentials.js';
export { compact, memoryCredentialStore } from './token/credentials.js';
export { readAccessTokenClaims, readAccessTokenExpiresAt } from './token/jwt.js';
export type { TokenManager, TokenManagerOptions } from './token/tokenManager.js';
export { createTokenManager } from './token/tokenManager.js';
