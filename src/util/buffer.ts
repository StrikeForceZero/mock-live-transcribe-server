import { Buffer, isUtf8 } from 'node:buffer';

export function bufferTextOrThrow(buffer: Buffer): string {
  if (!isUtf8(buffer)) {
    throw new Error('Buffer is not UTF-8');
  }
  return buffer.toString('utf8');
}
