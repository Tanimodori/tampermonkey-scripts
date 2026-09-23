import type { z } from 'zod';

/**
 * One endpoint, stated as the HTTP call it is.
 *
 * `method`, `path`, `params`, `query`, `body` and `response` carry exactly their usual meaning, which is
 * the point: a reader who knows the verb and the address knows what leaves, and the schema beside each one
 * is the runtime check on the thing that name describes. `path` is a template interpolated with `params`
 * (`path.ts`), `query` becomes the search string, `body` is sent verbatim as JSON.
 *
 * There is no request builder on an endpoint. `body` is the wire shape rather than something a function
 * turns the caller's arguments into, so the bytes that go out are the bytes the schema checked — a
 * keyword-wrapped payload (`{ getRecords: … }`) is visible in the schema and at the call site instead of
 * being assembled somewhere in between. On the answer side `unwrap` is a projection over what the schema
 * already accepted, and it changes nothing that was sent or checked.
 *
 * Two fields are not HTTP primitives and are kept anyway. `operation` names the call in every report about
 * it, which is how an error can say `getRecords` without quoting an address that may carry a credential.
 * `auth` is how the credential travels, because that is the one thing a caller must not be trusted to
 * remember per call: `'headers'` is the `Access-Token`/`Client-Id`/`Open-Id` three-piece, `'query-token'`
 * is `access_token` in the search string, `'none'` is a call the upstream answers without being told who
 * asks. `client_id` and `client_secret` are not auth — they are the two token grants' own declared
 * `query` parameters.
 */

/** How the credential travels with a call. */
export type AuthMode = 'headers' | 'query-token' | 'none';

/** Any schema an endpoint declares. */
type Schema = z.ZodType;

/** A schema field that an endpoint may leave out; leaving it out means the call carries no such part. */
type OptionalSchema = Schema | undefined;

/** The parts of a call a caller may supply, each present only when the endpoint declares a schema for it. */
interface CallParts<Params extends OptionalSchema, Query extends OptionalSchema, Body extends OptionalSchema> {
  readonly params: z.output<NonNullable<Params>>;
  readonly query: z.output<NonNullable<Query>>;
  readonly body: z.output<NonNullable<Body>>;
}

type PartName = keyof CallParts<OptionalSchema, OptionalSchema, OptionalSchema>;

/**
 * The parts a call must state for itself.
 *
 * `params` is deliberately absent: a coordinate is the one thing a client can be configured with, and
 * `ApiOptions.params` is exactly that, so a call that does not name one is not missing anything. `query`
 * and `body` have no other source, and so are required wherever their endpoint declares them.
 */
type RequiredPartName<Query extends OptionalSchema, Body extends OptionalSchema> = {
  [K in 'query' | 'body']: [CallParts<undefined, Query, Body>[K]] extends [never] ? never : K;
}['query' | 'body'];

/**
 * What `api.call` takes beside the endpoint.
 *
 * A part the endpoint declares is required and its schema types it, so a missing `body` is a compile error
 * rather than a request the upstream will refuse. A part it does not declare is absent from the type, so a
 * stray `body` on a `GET` is refused too.
 */
export type CallInput<Params extends OptionalSchema, Query extends OptionalSchema, Body extends OptionalSchema> = {
  readonly [K in PartName as K extends 'params' ? ([CallParts<Params, Query, Body>[K]] extends [never] ? never : K) : never]?: CallParts<
    Params,
    Query,
    Body
  >[K];
} & {
  readonly [K in RequiredPartName<Query, Body>]: CallParts<Params, Query, Body>[K];
};

/** An endpoint with every part declared, which is what a value of `Endpoint` is widened to. */
export type AnyEndpoint = Endpoint<OptionalSchema, OptionalSchema, OptionalSchema, Schema, unknown>;

/** One endpoint as the pipeline holds it. Build these with `defineEndpoint`, never by hand. */
export interface Endpoint<Params extends OptionalSchema, Query extends OptionalSchema, Body extends OptionalSchema, Answer extends Schema, Output> {
  readonly operation: string;
  readonly method: 'GET' | 'POST';
  readonly auth: AuthMode;
  readonly path: string;
  readonly params?: Params;
  readonly query?: Query;
  readonly body?: Body;
  readonly response: {
    /** Whether the answer carries the smartsheet envelope, which is the only thing that changes the verdict. */
    readonly envelope: boolean;
    /** The wire contract: what the upstream answers, in the shape it answers it in. */
    readonly schema: Answer;
    /** The part of that contract the caller is given, once the contract has been checked. */
    readonly unwrap?: (answer: unknown) => Output;
  };
}

/** What the caller hands `api.call` for one endpoint. */
export type InputOf<E extends AnyEndpoint> =
  E extends Endpoint<infer Params, infer Query, infer Body, infer _Answer, infer _Output> ? CallInput<Params, Query, Body> : never;

/** What `api.call` answers with for one endpoint. */
export type OutputOf<E extends AnyEndpoint> = E extends Endpoint<infer _Params, infer _Query, infer _Body, infer _Answer, infer Output> ? Output : never;

/** Whether one endpoint needs a second argument at all: only when it declares a part with no other source. */
export type CallArgs<E extends AnyEndpoint> =
  E extends Endpoint<infer _Params, infer Query, infer Body, infer _Answer, infer _Output>
    ? [RequiredPartName<Query, Body>] extends [never]
      ? [input?: InputOf<E>]
      : [input: InputOf<E>]
    : never;

/** One endpoint as its author writes it: the parts that never change are left out, and the answer's type is inferred. */
export interface EndpointDeclaration<Params extends OptionalSchema, Query extends OptionalSchema, Body extends OptionalSchema, Answer extends Schema, Output> {
  readonly operation: string;
  readonly path: string;
  readonly response: {
    readonly schema: Answer;
    readonly envelope?: boolean;
    readonly unwrap?: (answer: z.output<Answer>) => Output;
  };
  readonly method?: 'GET' | 'POST';
  readonly auth?: AuthMode;
  readonly params?: Params;
  readonly query?: Query;
  readonly body?: Body;
}

/**
 * Declares one endpoint, filling in the parts that are the same for every call this library makes.
 *
 * The defaults are the library's own shape rather than the upstream's: everything here is `POST` with a
 * JSON body behind the three-piece header and answered inside the smartsheet envelope, and the four
 * exceptions say so. `method`/`auth`/`envelope` are the only fields with defaults precisely because they
 * are the only ones with a majority answer — an endpoint that reads as `GET`/`'none'`/`false` is stating
 * where it departs from the rest, which is the information worth spending a line on.
 *
 * The cast on `unwrap` is the one place a schema's type is widened: `Endpoint` stores `unwrap` as taking
 * `unknown` so that every endpoint is assignable to `AnyEndpoint`, and the pipeline is what guarantees the
 * value handed to it is one `response.schema` already parsed.
 */
export function defineEndpoint<
  Params extends OptionalSchema = undefined,
  Query extends OptionalSchema = undefined,
  Body extends OptionalSchema = undefined,
  Answer extends Schema = Schema,
  Output = z.output<Answer>,
>(declaration: EndpointDeclaration<Params, Query, Body, Answer, Output>): Endpoint<Params, Query, Body, Answer, Output> {
  return {
    ...declaration,
    method: declaration.method ?? 'POST',
    auth: declaration.auth ?? 'headers',
    response: {
      envelope: declaration.response.envelope ?? true,
      schema: declaration.response.schema,
      ...(declaration.response.unwrap === undefined ? {} : { unwrap: declaration.response.unwrap as (answer: unknown) => Output }),
    },
  };
}
