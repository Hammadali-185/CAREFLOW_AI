import { Router } from 'express';
import type { HealthController } from '../controllers/health.controller.js';

export function createHealthRouter(controller: HealthController) {
  const router = Router();

  router.get('/health', (req, res, next) => {
    controller.liveness(req, res).catch(next);
  });

  router.get('/health/ready', (req, res, next) => {
    controller.readiness(req, res).catch(next);
  });

  router.get('/ready', (req, res, next) => {
    controller.readiness(req, res).catch(next);
  });

  return router;
}
