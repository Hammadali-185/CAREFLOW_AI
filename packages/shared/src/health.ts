import { z } from 'zod';

export const API_SERVICE_NAME = 'careflow-api';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal(API_SERVICE_NAME),
  timestamp: z.string().min(1),
});

export const readinessResponseSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  database: z.enum(['up', 'down']),
  timestamp: z.string().min(1),
});

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
