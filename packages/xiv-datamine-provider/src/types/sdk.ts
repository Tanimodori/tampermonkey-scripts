import type { Endpoint } from 'api-sdk-framework';
import type { DatamineClient } from '@/client/client';

/**
 * 本包用到的 `api-sdk-framework` 契约类型，以及以本包 client 为上下文的端点别名。
 *
 * 包内各层从这里取这些类型；运行时的值（`ApiError`、`ApiErrorCodes`、`createCall`）仍从框架直接导入——类型只为读，
 * 值才需要那一份实例。
 */

/** 包内用到的框架契约类型，逐名转出，不再各自写 `from 'api-sdk-framework'`。 */
export type { ApiErrorCode, ApiRequest, ApiResponse, Endpoint, RequestAdaptor, RequestSchema, ResponseAdaptor, ResponseSchema } from 'api-sdk-framework';

/** 以本包 client 为上下文的端点：契约来自框架，`context` 固定为 `DatamineClient`。 */
export type DatamineEndpoint<In, Out> = Endpoint<DatamineClient, In, Out>;
