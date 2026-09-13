import { getLogger } from '@logtape/logtape';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError, isAppError } from '@/errors.ts';
import type { ErrorCode } from '@/errors.ts';
import { LOG_CATEGORIES } from '@/logger.ts';
import { getRequestId } from './requestId.ts';

/**
 * The one place an error is recorded and worded.
 *
 * Everything that goes wrong on the request path — a thrown `AppError`, a body-parser failure, a
 * handler that forgot to catch — ends up here, so no other request-scoped code needs a logger: it
 * throws, and this decides both the response and the log line. A 5xx is the service's problem
 * (`error`), a 4xx is the caller's (`warning`); the access log carries the status either way.
 *
 * The body is the failure half of the one envelope every endpoint answers with: the same `code`,
 * `message` and `requestId` a success carries, with `data` left `null`. Everything the operator
 * needs beyond that — including the top of the stack, outside production — rides on the log line,
 * which is where a diagnostic belongs.
 */

interface BodyParserError extends Error {
  type?: string;
  status?: number;
  statusCode?: number;
}

function describe(error: unknown): { status: number; code: ErrorCode; message: string } {
  if (isAppError(error)) {
    return { status: error.status, code: error.code, message: error.message };
  }

  const candidate = error as BodyParserError | undefined;
  const type = candidate?.type;
  if (type === 'entity.too.large') {
    return { status: 413, code: 'ERR_PAYLOAD_TOO_LARGE', message: 'Request body exceeds the configured OPS_SERVER_JSON_BODY_LIMIT' };
  }
  if (type === 'entity.parse.failed') {
    return { status: 400, code: 'ERR_BAD_REQUEST', message: 'Request body is not valid JSON' };
  }
  if (type === 'encoding.unsupported' || type === 'charset.unsupported') {
    return { status: 415, code: 'ERR_UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported request body encoding; send UTF-8 JSON' };
  }
  return { status: 500, code: 'ERR_INTERNAL_ERROR', message: 'Internal server error' };
}

function reasonFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface ErrorHandlerDeps {
  readonly isProduction?: boolean;
}

export function errorHandler(deps: ErrorHandlerDeps): (error: unknown, req: Request, res: Response, next: NextFunction) => void {
  const logger = getLogger(LOG_CATEGORIES.http);

  return (error, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    const { status, code, message } = describe(error);
    const appError = isAppError(error) ? error : undefined;
    const requestId = getRequestId(req);

    // `originalUrl`, not `path`: a controller mounted under `/v1` rewrites the latter.
    const fields = { requestId, method: req.method, path: req.originalUrl, status, code, error: reasonFor(error) };
    // An unexpected failure outside production is diagnosable from the top of its stack, which the
    // log line carries instead of the response body.
    const stack = status >= 500 && deps.isProduction !== true && error instanceof Error ? error.stack?.split('\n').slice(0, 5) : undefined;
    const logged = stack === undefined ? fields : { ...fields, stack };
    if (status >= 500) logger.error('Request failed', logged);
    else logger.warning('Request rejected', logged);

    if (appError?.retryAfterSeconds !== undefined) {
      res.setHeader('Retry-After', String(appError.retryAfterSeconds));
    }
    for (const [header, value] of Object.entries(appError?.headers ?? {})) {
      res.setHeader(header, value);
    }

    res.status(status).json({ code, data: null, message, requestId });
  };
}

/** Anything no controller claimed: the error handler answers it, and records it. */
export function notFoundHandler(): RequestHandler {
  return (req, _res, next) => {
    next(new AppError('ERR_NOT_FOUND', `No handler for ${req.method} ${req.originalUrl}`));
  };
}

/** A known path with an unsupported verb; `Allow` rides on the error, the handler sets it. */
export function methodNotAllowed(allowed: readonly string[]): RequestHandler {
  return (req, _res, next) => {
    next(
      new AppError('ERR_METHOD_NOT_ALLOWED', `${req.method} is not allowed for ${req.originalUrl} (allowed: ${allowed.join(', ')})`, {
        headers: { Allow: allowed.join(', ') },
      }),
    );
  };
}
