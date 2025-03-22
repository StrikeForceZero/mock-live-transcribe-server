// doesn't block access to data, just flags
export class SoftLock<T> {
  private _locked = false;
  constructor(private readonly _inner: T) {}
  private set(locked: boolean): boolean {
    if (this._locked !== locked) {
      this._locked = locked;
      return true;
    }
    return false;
  }
  lock(): boolean {
    return this.set(true);
  }
  unlock() {
    return this.set(false);
  }
  get isLocked(): boolean {
    return this._locked;
  }
  get inner(): T {
    return this._inner;
  }
}
