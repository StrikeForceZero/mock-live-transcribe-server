import { delay } from '@util/delay';
import { userId, UserId } from '@server/types';

export type UsageData = {
  remainingMs: number;
  totalUsedMs: number;
};

function createUsage(remaining: number): UsageData {
  return {
    remainingMs: remaining,
    totalUsedMs: 0,
  };
}

export const STARTING_USAGE_LIMIT_MS = 1000;

export const MEMORY_STORAGE: Map<UserId, UsageData> = new Map(
  Object.entries({
    [userId('1')]: createUsage(STARTING_USAGE_LIMIT_MS),
    [userId('2')]: createUsage(STARTING_USAGE_LIMIT_MS),
  } satisfies Record<UserId, UsageData>) as [UserId, UsageData][],
);

export function resetStorage(maxUsage = STARTING_USAGE_LIMIT_MS): void {
  MEMORY_STORAGE.set(userId('1'), createUsage(maxUsage));
  MEMORY_STORAGE.set(userId('2'), createUsage(maxUsage));
}

resetStorage();

function _getUsage(userId: UserId): UsageData {
  return MEMORY_STORAGE.get(userId) ?? createUsage(0);
}

export async function getUsage(userId: UserId): Promise<UsageData> {
  await delay(50);
  return _getUsage(userId);
}

export async function updateUsage(
  userId: UserId,
  usedMs: number,
): Promise<void> {
  await delay(50);
  const usage = _getUsage(userId);
  MEMORY_STORAGE.set(userId, {
    ...usage,
    totalUsedMs: usage.totalUsedMs + usedMs,
    remainingMs: Math.max(usage.remainingMs - usedMs, 0),
  });
}
