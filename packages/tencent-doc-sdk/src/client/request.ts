import type { FetcherRequestInit } from '@apollo/utils.fetcher';
import type { z } from 'zod';
import { classifyResponse, invalidAnswer, transportFailure } from '@/validation/classify';
import type { CallShape, ResponseHeaders } from '@/validation/classify';
import { answerHeaderSchema } from '@/validation/schemas';
import type { ClientContext } from './context';

/**
 * One call: send it, read it, judge it, hand it over.
 *
 * This is where a call's cost is paid, and it owns the whole of the paying: the address is built in
 * `api/` and handed over already built, the verdict comes from `validation/`, and there is nothing in
 * between for a caller to attach itself to. Whoever owns the connection — pacing, metrics, a refusal, a
 * timeout — does so in the `Fetcher` it hands in, or around the client's own methods — because a library
 * that translates the upstream's endpoints one for one has no opinion about what those calls are worth to
 * anybody.
 *
 * There is no retry here, and that is the whole design: one method is one round trip. A caller that wants
 * a second attempt makes it, knowing that a write which failed may already have landed and that the
 * upstream's quota is spent either way.
 */

/**
 * One call, as its endpoint describes it: what to send, and how to read what comes back.
 *
 * `init` is deliberately the transport's own request shape and nothing more, so a call looks like a
 * request to whoever reads the sending half. The three fields added here are the endpoint's own vocabulary
 * rather than the transport's: `operation` names the call in every report about it, `envelope` says whether
 * the answer is worded in the smartsheet envelope this library knows how to judge, and `responseSchema` is
 * the endpoint's own response type.
 */
export interface CallPlan<S extends z.ZodType> extends ClientContext {
  /** The payload keyword (`getRecords`, `addRecords`, `refreshToken`, …), and the label every report carries. */
  readonly operation: string;
  /** Whether the answer carries the smartsheet envelope, which is the only thing that changes the verdict. */
  readonly envelope: boolean;
  readonly responseSchema: S;
}

/**
 * One round trip, judged and read: the answer as the endpoint's own type describes it, or the
 * `TencentDocsError` naming which thing went wrong.
 *
 * Three ways an answer is not usable, and each is worded where it is discovered: nothing arrived (or
 * nothing readable) is a `transport` failure, an arrived answer the envelope calls a failure is whatever
 * `classifyResponse` says it is, and an answer that the endpoint's own type has no words for is an
 * `invalid_answer`. A call whose address or payload could not be built never reaches this function — that
 * is the caller's own configuration talking, and `api/` words it before sending.
 */
export async function request<S extends z.ZodType>(url: URL, init: FetcherRequestInit, plan: CallPlan<S>): Promise<z.infer<S>> {
  // The path without its query string, twice over: `error.path` and the message both report a call by it,
  // and two of the OAuth calls carry a credential in exactly that query. `URL#pathname` never includes one.
  const { pathname: path } = url;
  const shape: CallShape = { operation: plan.operation, path, envelope: plan.envelope };

  let status: number;
  let headers: ResponseHeaders;
  let body: unknown;
  try {
    const response = await plan.transport(url.href, init);
    status = response.status;
    headers = Object.fromEntries(response.headers);
    body = await response.json();
  } catch (error) {
    // Three ways to get here and no answer: the upstream never replied, its body never finished arriving,
    // or what arrived was not JSON at all. None of them is classified — there is nothing to read a verdict
    // out of — so this failure is worded from the transport's own report, which keeps the original as a
    // cause instead of quoting it: that message spells out the URL it failed on, query string included.
    throw transportFailure(error, `${url.origin}${path}`, path);
  }

  const header = answerHeaderSchema.safeParse(body);
  const failure = classifyResponse({ status, headers, body, ...(header.success ? header.data : {}) }, shape);
  if (failure !== undefined) throw failure;

  const parsed = plan.responseSchema.safeParse(body);
  if (!parsed.success) throw invalidAnswer(shape, broken(parsed.error), { status, headers, body });
  return parsed.data;
}

/** Which field of the answer the endpoint's own type had no words for. */
function broken(issues: z.ZodError): string {
  return issues.issues.map((issue) => `${issue.path.length === 0 ? '(body)' : issue.path.join('.')}: ${issue.message}`).join('; ');
}
