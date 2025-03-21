import { AbortedError } from '@util/error';

export function rejectOnAbort(
  abortSignal: AbortSignal,
  allowAlreadyAborted = true,
): Promise<void> {
  if (abortSignal.aborted) {
    if (allowAlreadyAborted) {
      return Promise.reject(new AbortedError('already aborted'));
    }
    throw new AbortedError('already aborted');
  }
  return new Promise<void>((_, reject) =>
    abortSignal.addEventListener('abort', () =>
      reject(new AbortedError('aborted')),
    ),
  );
}

export function onAbort(
  abortSignal: AbortSignal,
  callback: (ev?: Event) => void,
  allowAlreadyAborted = true,
): void {
  if (abortSignal.aborted) {
    if (allowAlreadyAborted) {
      callback();
      return;
    }
    throw new AbortedError('already aborted');
  }
  abortSignal.addEventListener('abort', callback);
}
