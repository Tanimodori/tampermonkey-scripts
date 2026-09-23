// Re-exported rather than made consumers depend on it themselves: this is the shape a `transport` has to
// fit, and the package behind it carries types and nothing else.
export type { Fetcher, FetcherRequestInit, FetcherResponse } from '@apollo/utils.fetcher';

export type { TencentDocsErrorCode, TencentDocsErrorOptions, UpstreamResponse } from './validation/errors';
export { TencentDocsError } from './validation/errors';
export { describeBody } from './validation/classify';
export * from './validation/schemas';
export * from './validation/types';

// The endpoints are the package's vocabulary: a caller names the call it wants and `api.call` makes it, so
// exporting the set is what keeps an endpoint out of the caller's own construction business.
export type { AnyEndpoint, AuthMode, CallArgs, Endpoint, InputOf, OutputOf } from './endpoint';
export { defineEndpoint } from './endpoint';
export { accessToken, addRecords, deleteRecords, endpoints, getRecords, getSheetList, refreshToken, updateRecords, userinfo } from './endpoints';
export type { Api, ApiOptions } from './client';
export { createApi } from './client';
export type { DocCoordinates, PathParams } from './path';
export { buildPath, encodePathSegment } from './path';

export type { JwtToken } from './token/jwt';
export { parseJwtToken, readAccessTokenClaims, readAccessTokenExpiresAt } from './token/jwt';
export type { TokenManager, TokenManagerOptions } from './token/manager';
export { createTokenManager } from './token/manager';
export type { CredentialRecord, CredentialStore } from './token/store';
export { createCredentialStore } from './token/store';
