import { AbortedError } from '@util/error';

// TODO: should use option object
/**
 * Creates an object containing a promise that rejects when the given `AbortSignal` is aborted,
 * along with a `cancel` method to clean up the event listener.
 *
 * @param {AbortSignal} abortSignal - The signal that controls the abortion of the promise.
 * @param {boolean} [allowAlreadyAborted=true] - If true, allows the function to return a rejected promise
 *                                               when the signal is already aborted. If false, an error is thrown.
 * @param {boolean} [resolveOnCancel=false] - If true, resolves the promise instead of rejecting it
 *                                            when the `cancel` method is called.
 * @returns {{ promise: Promise<void>; cancel: () => void }} An object containing:
 *   - `promise`: A promise that rejects with an `AbortedError` if the signal is aborted.
 *   - `cancel`: A function to remove the event listener and, if `resolveOnCancel` is true, resolve the promise.
 * @throws {AbortedError} If the signal is already aborted and `allowAlreadyAborted` is false.
 */
export function rejectOnAbort(
  abortSignal: AbortSignal,
  allowAlreadyAborted = true,
  resolveOnCancel = false,
): { promise: Promise<void>; cancel: () => void } {
  if (abortSignal.aborted) {
    const err = new AbortedError('already aborted');
    if (allowAlreadyAborted) {
      return { promise: Promise.reject(err), cancel: () => {} };
    }
    throw err;
  }
  let rejectFn: (err: Error) => void;
  let resolveFn: () => void;
  const handler = () => rejectFn(new AbortedError('aborted'));

  const promise = new Promise<void>((resolve, reject) => {
    rejectFn = reject;
    resolveFn = resolve;
    abortSignal.addEventListener('abort', handler, { once: true });
  });

  return {
    promise,
    cancel: () => {
      if (resolveOnCancel) {
        resolveFn();
      }
      abortSignal.removeEventListener('abort', handler);
    },
  };
}

/**
 * Registers a callback to be called when the given `AbortSignal` is aborted.
 * If the signal is already aborted and `allowAlreadyAborted` is true, the callback will be invoked immediately.
 * Returns a cleanup function to remove the `abort` event listener if the signal is not already aborted.
 *
 * @param {AbortSignal} abortSignal - The signal to listen for the `abort` event.
 * @param {(ev?: Event) => void} callback - The callback to execute when the signal is aborted.
 * @param {boolean} [allowAlreadyAborted=true] - If true, invokes the callback immediately
 *                                              if the signal is already aborted. Throws an error if false.
 * @returns {void | (() => void)} A cleanup function to remove the event listener,
 *                                or `void` if the callback was invoked immediately.
 * @throws {AbortedError} If the signal is already aborted and `allowAlreadyAborted` is false.
 */
export function onAbort(
  abortSignal: AbortSignal,
  callback: (ev?: Event) => void,
  allowAlreadyAborted = true,
): void | (() => void) {
  if (abortSignal.aborted) {
    if (allowAlreadyAborted) {
      callback();
      return;
    }
    throw new AbortedError('already aborted');
  }
  abortSignal.addEventListener('abort', callback, { once: true });
  return () => {
    abortSignal.removeEventListener('abort', callback);
  };
}
