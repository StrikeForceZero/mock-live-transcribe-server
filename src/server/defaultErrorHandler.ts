import { NextFunction, Request, Response } from 'express';
import { HttpError } from '@util/error';

function isError(err: unknown): err is Error {
  return err instanceof Error;
}

function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError;
}

function extractStack(err: unknown): { stack?: string } {
  return isError(err) ? { stack: err.stack } : {};
}

export function defaultErrorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  let statusCode = 500;
  let message = 'Something went wrong';

  if (isHttpError(err)) {
    statusCode = err.statusCode;
  }

  if (isError(err)) {
    message = err.message;
  }

  res.status(statusCode).json({
    error: {
      message,
      // include the stack trace in development
      ...(process.env.NODE_ENV !== 'production' && extractStack(err)),
    },
  });
}
