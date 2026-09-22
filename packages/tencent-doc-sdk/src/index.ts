// Re-exported rather than made consumers depend on it themselves: this is the shape a `transport` has to
// fit, and the package behind it carries types and nothing else.
export type { Fetcher, FetcherRequestInit, FetcherResponse } from '@apollo/utils.fetcher';
export type { ClientOptions } from './client/context';

export type { TencentDocsErrorCode, TencentDocsErrorOptions, UpstreamResponse } from './validation/errors';
export { TencentDocsError } from './validation/errors';
export { describeBody } from './validation/classify';
export * from './validation/schemas';
export * from './validation/types';

export { encodePathSegment } from './api/address';
export type { DocCoordinates, EndpointTarget } from './api/address';
export type { DocClient, DocClientOptions } from './api/docClient';
export { createDocClient } from './api/docClient';
export type { GetRecordsParams, RecordUpdate, RecordValues } from './api/record';

export type { JwtToken } from './token/jwt';
export { parseJwtToken, readAccessTokenClaims, readAccessTokenExpiresAt } from './token/jwt';
export type { TokenManager, TokenManagerOptions } from './token/manager';
export { createTokenManager } from './token/manager';
export type { CredentialRecord, CredentialStore } from './token/store';
export { createCredentialStore } from './token/store';
