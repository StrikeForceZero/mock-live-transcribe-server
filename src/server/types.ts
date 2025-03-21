import { NextFunction, Request, RequestHandler, Response } from 'express';
import { Tagged } from 'type-fest';
import { UnauthorizedError } from '@util/error';

export type UserId = Tagged<string, 'USER_ID'>;

export function userId(id: string): UserId {
  return id as UserId;
}

export interface UnAuthenticatedRequest extends Request {
  user?: { id: UserId };
}

export interface AuthenticatedRequest extends Request {
  user: { id: UserId };
}

export type Middleware = (
  req: UnAuthenticatedRequest,
  res: Response,
  next: NextFunction,
) => void;

export type AuthenticatedRouteHandler = (
  req: AuthenticatedRequest,
  res: Response,
  next?: NextFunction,
) => Promise<void>;

export function isAuthenticatedRequest(
  req: Request,
): req is AuthenticatedRequest {
  return typeof (req as AuthenticatedRequest).user !== 'undefined';
}

export function withAuth(handler: AuthenticatedRouteHandler): RequestHandler {
  return (req, res, next) => {
    if (!isAuthenticatedRequest(req)) {
      throw new UnauthorizedError();
    }
    return handler(req, res, next).catch(next);
  };
}
