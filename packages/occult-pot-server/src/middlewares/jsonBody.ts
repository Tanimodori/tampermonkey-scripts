import bodyParser from 'body-parser';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '@/errors.ts';

/**
 * Parses JSON request bodies with the configured size limit, using `body-parser` directly.
 *
 * `strict: true` keeps the body a JSON object or array: a bare `"5"` is not a resource.
 */
export function jsonBody(limit: string): RequestHandler {
  return bodyParser.json({ limit, strict: true });
}

/**
 * API-only surface: requests that carry a body must announce JSON.
 *
 * `jsonBody` runs first, so a parsed body is already available. Only the primary media type is
 * considered, so a bogus header such as `text/plain, application/json` is still rejected. The
 * refusal is an `AppError`, so the error handler words and records it like any other.
 */
export function requireJsonForBody(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const method = req.method.toUpperCase();
    if (method !== 'POST' && method !== 'PUT' && method !== 'PATCH') return next();

    const header = req.headers['content-type'];
    const primaryType = header?.split(';')[0]?.split(',')[0]?.trim().toLowerCase();
    if (primaryType === 'application/json') return next();

    const received = primaryType === undefined || primaryType === '' ? '' : `, received ${JSON.stringify(primaryType)}`;
    next(new AppError('UNSUPPORTED_MEDIA_TYPE', `Content-Type must be application/json for ${method} requests${received}`));
  };
}
