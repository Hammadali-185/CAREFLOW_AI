export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly expose: boolean;

  constructor(statusCode: number, code: string, message: string, expose = true) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.expose = expose;
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'The requested resource was not found.') {
    super(404, 'NOT_FOUND', message);
  }
}
