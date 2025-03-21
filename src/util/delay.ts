import assert from 'node:assert';

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

export function delayExposeTimeout(ms: number) {
  let timeout: NodeJS.Timeout | null = null;
  const promise = new Promise(
    (resolve) => (timeout = setTimeout(resolve, ms).unref()),
  );
  assert(
    timeout !== null,
    'timeout should not be null - js engine did not execute promise callback',
  );
  return {
    promise,
    timeout,
  };
}
