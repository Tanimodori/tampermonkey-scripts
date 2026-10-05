// 再转出而不是让使用方自己依赖它：这就是 `transport` 要贴的形状，而它背后的包只装类型。
export type { Fetcher, FetcherHeaders, FetcherRequestInit, FetcherResponse, WebFetcher, WebFetcherRequestInit } from 'universal-fetch-type';

// 框架的公开面就是本库的公开面：`ApiError`、`ApiErrorCodes` 与端点契约类型因此不必由使用方单独依赖框架。
export * from 'api-sdk-framework';

export type { CallArgs, TDocClient, TDocClientOptions } from './client';
export { createTDocClient } from './client';
export type { Envelope } from './error';
export { describeBody, getBareAnswer, getEnvelope, verifyEnvelope } from './error';

// schema 与它们的类型是包的一部分词汇：使用方读得到答复的每一段是怎么被描述的。
export * from './endpoints/schema';

// 端点是包的词汇：调用方点名要哪个调用，`client.call` 把它做成；转出集合与每个名字，端点不必由调用方自己构造。
export { accessToken, addRecords, deleteRecords, endpoints, getRecords, getSheetList, refreshToken, updateRecords, userinfo } from './endpoints';
export type { DocCoordinates, PathParams } from './path';
export { buildPath, encodePathSegment } from './path';

export type { JwtToken } from './token/jwt';
export { parseJwtToken, readAccessTokenClaims, readAccessTokenExpiresAt } from './token/jwt';
export type { TokenManager, TokenManagerOptions } from './token/manager';
export { createTokenManager } from './token/manager';
export type { CredentialRecord, CredentialStore } from './token/store';
export { createCredentialStore } from './token/store';
