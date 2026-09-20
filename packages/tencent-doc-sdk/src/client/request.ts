import type { Dispatcher } from 'undici';
import type { z } from 'zod';
import { classifyResponse, invalidAnswer, transportFailure } from '@/validation/classify.js';
import type { CallShape, ResponseHeaders } from '@/validation/classify.js';
import { answerHeaderSchema } from '@/validation/schemas.js';
import type { DispatchGate } from './dispatch.js';
import type { UpstreamHooks } from './hooks.js';

/**
 * One call: send it, read it, judge it, report it.
 *
 * This is where a call's cost is paid. It owns nothing else — the pacing is the caller's (`dispatch`),
 * the accounting is the caller's (`hooks`), and what a failure then *means* to the outside world is the
 * caller's too; this only says which of the six things went wrong.
 *
 * There is no retry here, and that is the whole design: one entry is one round trip. A caller that
 * wants a second attempt makes it, knowing that a write which failed may already have landed and that
 * the upstream's quota is spent either way.
 */

/** One call, as its caller describes it. */
export interface CallRequest {
  /** The payload keyword, and the label every report about this call carries. */
  readonly operation: string;
  readonly origin: string;
  readonly path: string;
  readonly method: Dispatcher.HttpMethod;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

/** What a call needs from whoever is making it: a transport, a pacing gate, and somewhere to report. */
export interface CallContext {
  readonly transport: () => Dispatcher;
  readonly dispatch: DispatchGate;
  readonly hooks?: UpstreamHooks;
  readonly now: () => number;
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
export function sendEnvelope<S extends z.ZodType>(request: CallRequest, responseSchema: S, context: CallContext): Promise<z.infer<S>> {
  return sendCall(request, true, context).then((answer) => parseAnswer(responseSchema, answer, request, context));
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
export function sendBare<S extends z.ZodType>(request: CallRequest, responseSchema: S, context: CallContext): Promise<z.infer<S>> {
  return sendCall(request, false, context).then((answer) => parseAnswer(responseSchema, answer, request, context));
}

/** One call, under the caller's pacing. */
function sendCall(request: CallRequest, envelope: boolean, context: CallContext): Promise<unknown> {
  const shape: CallShape = { operation: request.operation, envelope };
  return context.dispatch({ operation: request.operation }, () => oneAttempt(request, shape, context));
}

/**
 * One round trip, and the one report whoever is watching gets about it: what was asked, how long it
 * took, what came back. Only the envelope's business code and the verdict are reported — never the
 * body itself (a read's body is the whole sheet) and never a request header (the credential travels
 * in one).
 */
async function oneAttempt(request: CallRequest, shape: CallShape, context: CallContext): Promise<unknown> {
  const described = { operation: request.operation, method: request.method, path: displayPath(request.path) };
  const startedAt = context.now();

  let statusCode: number;
  let headers: ResponseHeaders;
  let answer: unknown;
  try {
    const response = await context
      .transport()
      .request({ origin: request.origin, path: request.path, method: request.method, headers: request.headers, body: request.body });
    statusCode = response.statusCode;
    headers = { ...response.headers };
    answer = await response.body.json();
  } catch (error) {
    // Three ways to get here and no answer: the upstream never replied, its body never finished
    // arriving, or what arrived was not JSON at all. None of them is classified — there is nothing to
    // read a verdict out of — so this failure is worded from the transport's own report.
    //
    // The report carries *that* wording, never the error's own message: a transport error quotes the
    // URL it failed on, query string included, and two of the upstream's calls carry a credential
    // there.
    const durationMs = context.now() - startedAt;
    const failure = transportFailure(error, `${request.origin}${displayPath(request.path)}`);
    context.hooks?.onCall?.(described, { kind: 'unsent', code: failure.code, reason: failure.message, durationMs });
    throw failure;
  }

  const header = answerHeaderSchema.safeParse(answer);
  const { ret, msg } = header.success ? header.data : {};
  const durationMs = context.now() - startedAt;
  const failure = classifyResponse({ status: statusCode, headers, body: answer, ret, msg }, shape);

  if (failure !== undefined) {
    context.hooks?.onCall?.(described, {
      kind: 'failed',
      status: statusCode,
      ret,
      code: failure.code,
      retryAfterSeconds: failure.retryAfterSeconds,
      durationMs,
    });
    throw failure;
  }

  context.hooks?.onCall?.(described, { kind: 'answered', status: statusCode, ret, durationMs });
  return answer;
}

/**
 * Validates one part of an answer, reporting a shape this library cannot read as the upstream's
 * failure rather than as an internal one: it is the answer that is wrong, and the message says which
 * field of it, quoting the body the way the table does.
 */
function parseAnswer<S extends z.ZodType>(schema: S, value: unknown, request: CallRequest, context: CallContext): z.infer<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const said = result.error.issues.map((issue) => `${issue.path.length === 0 ? '(body)' : issue.path.join('.')}: ${issue.message}`).join('; ');
  const failure = invalidAnswer(request.operation, value, said);
  context.hooks?.onParseFailure?.({ operation: request.operation, method: request.method, path: displayPath(request.path) }, failure);
  throw failure;
}

/**
 * A call's path without its query string.
 *
 * The two OAuth calls carry their credential in the query string (`access_token` for `userinfo`,
 * `client_secret` and `refresh_token` for the refresh), and a report — which can reach a log line or an
 * HTTP response — is no place for either. No call this library makes is identified by its query
 * string, so dropping it loses nothing.
 */
function displayPath(path: string): string {
  return path.split('?')[0]!;
}
