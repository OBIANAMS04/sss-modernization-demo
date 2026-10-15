export class AppError extends Error {
  /** STORY-016: set when the access policy refused the request, so the audit entry names the rule and the policy version. */
  policy?: { rule: string; reason: string; policyVersion: number };

  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, public fields?: Record<string, string>) {
    super(400, message, 'VALIDATION_ERROR');
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, 'CONFLICT');
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(401, message, 'UNAUTHORIZED');
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

/** STORY-018: a person has asked too often; the route sends how long to wait in Retry-After. */
export class RateLimitError extends AppError {
  constructor(message: string, public retryAfterSeconds: number) {
    super(429, message, 'RATE_LIMITED');
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Not found') {
    super(404, message, 'NOT_FOUND');
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}
