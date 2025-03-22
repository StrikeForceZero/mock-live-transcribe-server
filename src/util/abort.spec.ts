import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { onAbort, rejectOnAbort } from '@util/abort';

describe('abort', () => {
  let abortController: AbortController;
  beforeEach(() => {
    abortController = new AbortController();
  });
  it('should handle on abort', () => {
    const cb = jest.fn();
    onAbort(abortController.signal, cb);
    abortController.abort();
    expect(cb).toHaveBeenCalled();
  });
  it('should run cb on already aborted', () => {
    abortController.abort();
    const cb = jest.fn();
    onAbort(abortController.signal, cb);
    expect(cb).toHaveBeenCalled();
  });
  it('should throw on already aborted', () => {
    abortController.abort();
    const cb = jest.fn();
    expect(() => onAbort(abortController.signal, cb, false)).toThrow(
      'already aborted',
    );
    expect(cb).not.toHaveBeenCalled();
  });
  it('should reject on abort', () => {
    const promise = rejectOnAbort(abortController.signal);
    abortController.abort();
    return expect(promise).rejects.toThrow('aborted');
  });
  it('should throw with error on already aborted', () => {
    abortController.abort();
    expect(() => rejectOnAbort(abortController.signal, false)).toThrow(
      'already aborted',
    );
  });
  it('should reject with error on already aborted', async () => {
    abortController.abort();
    await expect(rejectOnAbort(abortController.signal)).rejects.toThrow(
      'already aborted',
    );
  });
});
