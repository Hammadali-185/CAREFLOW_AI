import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app-error.js';
import type { NodeEnv } from '../config/env.js';
import type { Logger } from '../utils/logger.js';
import { scrub } from '../utils/logger.js';

export function errorHandler(nodeEnv: NodeEnv, logger: Logger) {
  return function handleError(error: unknown, req: Request, res: Response, _next: NextFunction) {
    if (isJsonSyntaxError(error)) {
      res.status(400).json({
        error: {
          code: 'INVALID_JSON',
          message: 'Request body must be valid JSON.',
        },
      });
      return;
    }

    if (error instanceof AppError && error.expose) {
      logger.warn('Handled request error', {
        method: req.method,
        path: req.path,
        status: error.statusCode,
        code: error.code,
      });
      res.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message,
        },
      });
      return;
    }

    const statusCode = error instanceof AppError ? error.statusCode : 500;
    const safeMessage =
      nodeEnv === 'production'
        ? 'Something went wrong.'
        : scrub(error instanceof Error ? error.message : 'Something went wrong.');

    logger.error('Unhandled request error', {
      method: req.method,
      path: req.path,
      status: statusCode,
    });

    res.status(statusCode).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: safeMessage,
      },
    });
  };
}

function isJsonSyntaxError(error: unknown): error is SyntaxError & { status: number } {
  return (
    error instanceof SyntaxError && 'status' in error && error.status === 400 && 'body' in error
  );
}
