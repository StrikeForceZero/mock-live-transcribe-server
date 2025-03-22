import { describe, expect, it } from '@jest/globals';
import { delay } from '@util/delay';
import { timeout } from '@util/timeout';

describe('timeout', () => {
  it('should timeout', async () => {
    await expect(timeout(1000, () => delay(2000))).rejects.toThrow('timeout');
  });
  it('should not timeout', async () => {
    await expect(timeout(1000, () => Promise.resolve(1))).resolves.toBe(1);
  });
  it('should handle abort', async () => {
    const abort = new AbortController();
    const promise = timeout(1000, () => delay(2000), {
      abortController: abort,
    });
    abort.abort();
    await expect(promise).rejects.toThrow('aborted');
  });
  it('should handle already abort', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(() =>
      timeout(1000, () => delay(2000), {
        abortController: abort,
      }),
    ).rejects.toThrow('aborted');
  });
  it('should throw already aborted', () => {
    const abort = new AbortController();
    abort.abort();
    expect(() =>
      timeout(1000, () => delay(2000), {
        abortController: abort,
        allowAlreadyAborted: false,
      }),
    ).toThrow('already aborted');
  });
  it('should reject already aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(() =>
      timeout(1000, () => delay(2000), {
        abortController: abort,
        allowAlreadyAborted: true,
      }),
    ).rejects.toThrow('aborted');
  });
});
