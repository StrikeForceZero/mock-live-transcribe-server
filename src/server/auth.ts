import { UserId, userId } from '@server/types';

export const AUTH_TOKEN = new Map(
  Object.entries({
    a: userId('1'),
    b: userId('2'),
  }),
);

export function getTokenFromAuthorization(
  auth: string | undefined,
): string | null {
  if (!auth || !auth.startsWith('Bearer ')) {
    return null;
  }
  return auth.split(' ')[1] ?? '';
}

export function getUserIdFromToken(token: string): UserId | null {
  return AUTH_TOKEN.get(token) ?? null;
}
