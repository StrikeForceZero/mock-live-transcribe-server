import { Buffer, isUtf8 } from 'node:buffer';

export function bufferTextOrThrow(buffer: Buffer): string {
  if (!isUtf8(buffer)) {
    throw new Error('Buffer is not UTF-8');
  }
  return buffer.toString('utf8');
}

export function insertIdIntoBuffer(id: number, buffer: Buffer): Buffer {
  const idBuffer = Buffer.alloc(4);
  idBuffer.writeUInt32BE(id);
  return Buffer.concat([idBuffer, buffer]);
}

export function getIdFromBuffer(buffer: Buffer): {
  id: number;
  data: Buffer<ArrayBufferLike>;
} {
  return {
    id: buffer.readUInt32BE(0),
    data: buffer.subarray(4),
  };
}

export interface IWrap {
  wrap(buffer: Buffer): Buffer;
}

export class BufferCounter implements IWrap {
  constructor(private _lastId = 0) {}
  wrap(buffer: Buffer): Buffer {
    this._lastId += 1;
    return insertIdIntoBuffer(this._lastId, buffer);
  }
  get lastId() {
    return this._lastId;
  }
}
