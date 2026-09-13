import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

export interface RequestWithContext extends Request {
  requestId?: string;
}

export function requestId(): (req: RequestWithContext, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const inbound = req.get(REQUEST_ID_HEADER);
    const id = inbound !== undefined && /^[\w.:-]{1,128}$/.test(inbound) ? inbound : randomUUID();
    req.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
  };
}

export function getRequestId(req: Request): string {
  return (req as RequestWithContext).requestId ?? 'unknown';
}
