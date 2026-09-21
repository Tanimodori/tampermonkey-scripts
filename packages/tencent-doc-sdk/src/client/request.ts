import type { Dispatcher } from 'undici';
import type { z } from 'zod';
import { cannotAssemble, classifyResponse, invalidAnswer, transportFailure } from '@/validation/classify.js';
import type { CallShape, ResponseHeaders, UpstreamAnswer } from '@/validation/classify.js';
import { answerHeaderSchema } from '@/validation/schemas.js';
import type { ClientContext } from './context.js';

/**
 * One call: send it, read it, judge it, hand it over.
 *
 * This is where a call's cost is paid, and it owns the whole of the paying: the address comes from
 * `api/`, the verdict from `validation/`, and there is nothing in between for a caller to attach itself
 * to. Whoever paces, measures, logs or refuses a call does so around these functions — with the
 * `Dispatcher` they hand in, or around the client's own methods — because a library that translates the
 * upstream's endpoints one for one has no opinion about what those calls are worth to anybody.
 *
 * There is no retry here, and that is the whole design: one method is one round trip. A caller that wants
 * a second attempt makes it, knowing that a write which failed may already have landed and that the
 * upstream's quota is spent either way.
 */

/** One call, as its endpoint describes it. */
export interface CallRequest {
  /** The payload keyword, and the label every report about this call carries. */
  readonly operation: string;
  readonly origin: string;
  /** The path to send to, query string included: two of the OAuth calls carry a credential in it. */
  readonly path: string;
  readonly method: Dispatcher.HttpMethod;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

/**
 * One endpoint's call, put together.
 *
 * Assembling a request is the first way a call can fail without the upstream being asked anything: an
 * `apiBase` that is not a URL, a payload that will not become JSON. Both are the caller's own
 * configuration talking, so both are worded as a `config` failure with the original kept as its cause —
 * a bare `TypeError` leaving this package would be the one error a caller could not classify.
 */
export function assembleCall(operation: string, build: () => Omit<CallRequest, 'operation'>): CallRequest {
  try {
    return { ...build(), operation };
  } catch (error) {
    throw cannotAssemble(operation, error);
  }
}

/** How one call's answer is to be read: whether it wears the envelope, and which type describes it. */
interface CallPlan<S extends z.ZodType> {
  readonly envelope: boolean;
  readonly responseSchema: S;
}

/**
 * Sends one call whose answer is worded in the smartsheet envelope — where an HTTP 200 can still be a
 * failure, and only the business `ret` says so.
 *
 * `responseSchema` is the endpoint's own response type (`GetRecordsResponseSchema` and friends): this
 * parses the answer once, into it, and the caller reads sections off a typed value. A body that is not
 * JSON, or is JSON in a shape that type does not describe, is the upstream's failure to answer — named
 * for the field that broke, quoting the body it did send.
 */
export function sendEnvelope<S extends z.ZodType>(request: CallRequest, responseSchema: S, context: ClientContext): Promise<z.infer<S>> {
  return sendCall(request, { envelope: true, responseSchema }, context);
}

/**
 * Sends one call whose answer is the endpoint's own — the token endpoint, which answers a bad
 * credential with a `400` and a body its caller reads itself. Transport failures and a 429/5xx/401/403
 * are still judged; a business code is not.
 *
 * `responseSchema` describes that answer, but every field of it is optional: the point is to read the
 * fields that are there, and leave the endpoint's own failure for the caller to word. Its schema is
 * what makes that readable without a cast.
 */
export function sendBare<S extends z.ZodType>(request: CallRequest, responseSchema: S, context: ClientContext): Promise<z.infer<S>> {
  return sendCall(request, { envelope: false, responseSchema }, context);
}

/** One round trip, judged and read: its answer, or the `TencentDocsError` naming which thing went wrong. */
async function sendCall<S extends z.ZodType>(request: CallRequest, plan: CallPlan<S>, client: ClientContext): Promise<z.infer<S>> {
  const shape: CallShape = { operation: request.operation, path: displayPath(request.path), envelope: plan.envelope };
  const answer = await deliver(request, shape, client);

  const failure = classifyResponse(answer, shape);
  if (failure !== undefined) throw failure;

  const parsed = plan.responseSchema.safeParse(answer.body);
  if (!parsed.success) throw invalidAnswer(shape, broken(parsed.error), { status: answer.status, headers: answer.headers, body: answer.body });
  return parsed.data;
}

/** The round trip and nothing else: the transport's answer, read as far as this module has to read it. */
async function deliver(request: CallRequest, shape: CallShape, client: ClientContext): Promise<UpstreamAnswer> {
  let status: number;
  let headers: ResponseHeaders;
  let body: unknown;
  try {
    const response = await client
      .transport()
      .request({ origin: request.origin, path: request.path, method: request.method, headers: request.headers, body: request.body });
    status = response.statusCode;
    headers = { ...response.headers };
    body = await response.body.json();
  } catch (error) {
    // Three ways to get here and no answer: the upstream never replied, its body never finished
    // arriving, or what arrived was not JSON at all. None of them is classified — there is nothing to
    // read a verdict out of — so this failure is worded from the transport's own report, which keeps the
    // original as a cause instead of quoting it: that message spells out the URL it failed on, query
    // string included, and two of the upstream's calls carry a credential there.
    throw transportFailure(error, `${request.origin}${shape.path}`, shape.path);
  }

  const header = answerHeaderSchema.safeParse(body);
  const { ret, msg } = header.success ? header.data : {};
  return { status, headers, body, ret, msg };
}

/** Which field of the answer the endpoint's own type had no words for. */
function broken(issues: z.ZodError): string {
  return issues.issues.map((issue) => `${issue.path.length === 0 ? '(body)' : issue.path.join('.')}: ${issue.message}`).join('; ');
}

/**
 * A call's path without its query string.
 *
 * The two OAuth calls carry their credential in the query string (`access_token` for `userinfo`,
 * `client_secret` and `refresh_token` for the refresh), and an error — which can reach a log line or an
 * HTTP response — is no place for either. No call this library makes is identified by its query string,
 * so dropping it loses nothing.
 */
function displayPath(path: string): string {
  return path.split('?')[0]!;
}
