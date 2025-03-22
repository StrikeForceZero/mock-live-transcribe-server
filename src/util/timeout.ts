import { onAbort, rejectOnAbort } from '@util/abort';
import { delayExposeTimeout } from '@util/delay';
import { AbortedError, TimeoutError } from '@util/error';

export interface TimeoutOpt {
  abortController?: AbortController;
  allowAlreadyAborted?: boolean;
}

export function timeout<T>(
  ms: number,
  fn: (abortSignal: AbortSignal) => T,
  opt: TimeoutOpt = {},
): Promise<T> {
  const timeout = delayExposeTimeout(ms);
  const abortController = opt.abortController ?? new AbortController();
  let { allowAlreadyAborted } = opt;
  // default to true to match other signatures
  allowAlreadyAborted = allowAlreadyAborted ?? true;
  if (abortController.signal.aborted) {
    if (allowAlreadyAborted) {
      return Promise.reject(new AbortedError('aborted'));
    }
    throw new AbortedError('already aborted');
  }
  let wasTimeout = false;
  void timeout.promise.then(() => {
    wasTimeout = true;
    abortController.abort();
  });
  const cleanup = onAbort(
    abortController.signal,
    () => {
      clearTimeout(timeout.timeout);
    },
    opt.allowAlreadyAborted,
  );
  const rejectOnAbortObj = rejectOnAbort(abortController.signal);
  return Promise.race([
    fn(abortController.signal),
    // pretend its Promise<T> because it will always reject
    rejectOnAbortObj.promise.catch((err: unknown) => {
      let error: Error;

      if (wasTimeout) {
        error = new TimeoutError('timeout');
      } else if (err instanceof Error) {
        error = err;
      } else if (typeof err === 'object' && err !== null) {
        error = new Error(JSON.stringify(err));
      } else {
        error = new Error(String(err));
      }

      return Promise.reject(error);
    }) as Promise<T>,
  ]).finally(() => {
    cleanup?.();
    rejectOnAbortObj.cancel();
  });
}
