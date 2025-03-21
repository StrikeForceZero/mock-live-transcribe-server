export abstract class HttpError extends Error {
  abstract statusCode: number;
  constructor(message: string) {
    super(message);
    // breaks if minified
    this.name = new.target.name;

    // Restore prototype chain (fix for transpiled JS environments)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class UnauthorizedError extends HttpError {
  statusCode = 401;
  constructor(message: string = 'Unauthorized') {
    super(message);
    // breaks if minified
    this.name = new.target.name;

    // Restore prototype chain (fix for transpiled JS environments)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    // breaks if minified
    this.name = new.target.name;

    // Restore prototype chain (fix for transpiled JS environments)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AbortedError extends Error {
  constructor(message: string) {
    super(message);
    // breaks if minified
    this.name = new.target.name;

    // Restore prototype chain (fix for transpiled JS environments)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ConnectionClosedUnexpectedlyError extends Error {
  constructor(message: string) {
    super(message);
    // breaks if minified
    this.name = new.target.name;

    // Restore prototype chain (fix for transpiled JS environments)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ExceededAllocatedUsageError extends Error {
  constructor(message: string) {
    super(message);
    // breaks if minified
    this.name = new.target.name;

    // Restore prototype chain (fix for transpiled JS environments)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
