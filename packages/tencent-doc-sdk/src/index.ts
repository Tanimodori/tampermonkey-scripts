export type { ClientContext, ClientOptions } from './client/context.js';
export type { CallRequest } from './client/request.js';
export { DEFAULT_TIMEOUT_MS, newDispatcher } from './client/transport.js';

export type { TencentDocsErrorCode, TencentDocsErrorOptions, UpstreamResponse } from './validation/errors.js';
export { TencentDocsError } from './validation/errors.js';
export { describeBody } from './validation/classify.js';
export * from './validation/schemas.js';
export * from './validation/types.js';

export { encodePathSegment } from './api/address.js';
export type { DocCoordinates, EndpointTarget } from './api/address.js';
export type { DocClient, DocClientOptions } from './api/docClient.js';
export { createDocClient } from './api/docClient.js';
export type { GetRecordsParams, RecordUpdate, RecordValues } from './api/record.js';

export { readAccessTokenClaims, readAccessTokenExpiresAt } from './token/jwt.js';
export type { TokenManager, TokenManagerOptions } from './token/manager.js';
export { createTokenManager } from './token/manager.js';
export type { CredentialRecord, CredentialStore } from './token/store.js';
export { createCredentialStore } from './token/store.js';
