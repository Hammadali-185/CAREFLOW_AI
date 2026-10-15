import type { Request, Response } from 'express';
import type { HealthService } from '../services/health.service.js';
import { emptyQuerySchema } from '../validators/health.js';
import { parseRequest } from '../validators/parse-request.js';

export function createHealthController(service: HealthService) {
  return {
    async liveness(req: Request, res: Response) {
      parseRequest(emptyQuerySchema, { ...req.query });
      res.status(200).json(service.liveness());
    },
    async readiness(req: Request, res: Response) {
      parseRequest(emptyQuerySchema, { ...req.query });
      const body = await service.readiness();
      res.status(body.status === 'ok' ? 200 : 503).json(body);
    },
  };
}

export type HealthController = ReturnType<typeof createHealthController>;
