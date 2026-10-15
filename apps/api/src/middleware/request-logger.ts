import type { NextFunction, Request, Response } from 'express';
import type { Logger } from '../utils/logger.js';

export function requestLogger(logger: Logger) {
  return function logRequest(req: Request, res: Response, next: NextFunction) {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      logger.info('request', {
        method: req.method,
        path: req.originalUrl.split('?')[0] ?? req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(durationMs),
      });
    });

    next();
  };
}
