import type { z } from 'zod';
import { AppError } from '../errors/app-error.js';

export function parseRequest<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
): z.infer<TSchema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(' ');
    throw new AppError(400, 'VALIDATION_ERROR', message || 'Request validation failed.');
  }

  return parsed.data;
}
