import type { NextFunction, Request, Response } from 'express';
import { NotFoundError } from '../errors/app-error.js';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new NotFoundError(`No route matches ${req.method} ${req.path}.`));
}
