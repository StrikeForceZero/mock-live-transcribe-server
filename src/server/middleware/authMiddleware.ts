import { Response } from 'express';
import { getTokenFromAuthorization, getUserIdFromToken } from '@server/auth';
import { Middleware } from '@server/types';

function unauthorized(res: Response): void {
  res.status(401).json({ error: 'Unauthorized' });
}

export const authMiddleware: Middleware = (req, res, next) => {
  const token = getTokenFromAuthorization(req.headers.authorization);
  if (!token) {
    return unauthorized(res);
  }
  const userId = getUserIdFromToken(token);
  if (!userId) {
    return unauthorized(res);
  }
  req.user = { id: userId };
  next();
};

export default authMiddleware;
