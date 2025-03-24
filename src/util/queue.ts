class PingPongBuffer<T> {
  private readonly _bufferA: T[];
  private readonly _bufferB: T[];
  private _writeBuffer: T[];
  private _readBuffer: T[];
  private _writeSize: number = 0;
  private _readSize: number = 0;

  constructor(capacity: number = 1024) {
    this._bufferA = new Array<T>(capacity);
    this._bufferB = new Array<T>(capacity);
    this._writeBuffer = this._bufferA;
    this._readBuffer = this._bufferB;
  }

  /** Write a value to the write buffer */
  write(value: T): void {
    if (this._writeSize >= this._writeBuffer.length) {
      throw new Error('Write buffer overflow');
    }
    this._writeBuffer[this._writeSize++] = value;
  }

  /** Read a value from the read buffer at a given index */
  read(index: number): T | undefined {
    if (index >= this._readSize) {
      return undefined;
    }
    return this._readBuffer[index];
  }

  /** Get the current number of items */
  size(): number {
    return this._readSize + this._writeSize;
  }

  readSize(): number {
    return this._readSize;
  }

  writeSize(): number {
    return this._writeSize;
  }

  /** Swap read and write buffers, making written data available for reading */
  swap(): void {
    const temp = this._writeBuffer;
    this._writeBuffer = this._readBuffer;
    this._readBuffer = temp;

    this._readSize = this._writeSize;
    this._writeSize = 0;
  }

  /** Clear both buffers (soft reset) */
  clear(): void {
    this._writeSize = 0;
    this._readSize = 0;
  }

  toArray(): T[] {
    return this._readBuffer.slice(0, this._readSize);
  }

  getWriteSlice(): T[] {
    return this._writeBuffer.slice(0, this._writeSize);
  }

  getReadSlice(fromIndex: number): T[] {
    return this._readBuffer.slice(fromIndex, this._readSize);
  }
}

export class Queue<T> {
  private buffer = new PingPongBuffer<T>();
  private readIndex: number = 0;
  private hasWritten: boolean = false;

  enqueue(item: T): void {
    this.buffer.write(item);
    this.hasWritten = true;
  }

  dequeue(): T | undefined {
    // since we are interchangeably writing and reading
    // this cheats by seeing checking to make sure we've exhausted the readBuffer before swapping
    this.flush();
    if (this.readIndex >= this.buffer.readSize()) {
      return undefined;
    }
    return this.buffer.read(this.readIndex++);
  }

  peek(): T | undefined {
    this.flush();
    return this.buffer.read(this.readIndex);
  }

  isEmpty(): boolean {
    return this.readIndex >= this.buffer.size();
  }

  size(): number {
    return this.buffer.size() - this.readIndex;
  }

  clear(): void {
    this.buffer.clear();
    this.readIndex = 0;
  }

  toArray(): T[] {
    const readItems = this.buffer.getReadSlice(this.readIndex);
    const pendingWrites = this.hasWritten ? this.buffer.getWriteSlice() : [];
    return [...readItems, ...pendingWrites];
  }

  findIndex(predicate: (item: T) => boolean): number {
    return this.buffer.toArray().findIndex(predicate);
  }

  filter(predicate: (item: T) => boolean): T[] {
    return this.buffer.toArray().filter(predicate);
  }

  private flush(): void {
    if (!this.hasWritten) {
      return;
    }
    if (this.readIndex < this.buffer.readSize()) {
      return;
    }

    this.hasWritten = false;
    this.buffer.swap();
    this.readIndex = 0;
  }
}
