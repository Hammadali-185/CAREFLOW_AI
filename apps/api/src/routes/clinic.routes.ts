import { Router } from 'express';
import type { ClinicController } from '../controllers/clinic.controller.js';
import { createAuthenticate, createRequireClinicRole } from '../middleware/security.js';
import type { NodeEnv } from '../config/env.js';
import type { AuthService } from '../services/auth.service.js';

export function createClinicRouter(
  controller: ClinicController,
  auth: AuthService,
  nodeEnv: NodeEnv,
) {
  const router = Router();
  const authenticate = createAuthenticate(auth, nodeEnv);

  router.get(
    '/clinics/:clinicId',
    authenticate,
    createRequireClinicRole(auth, ['owner', 'staff', 'patient']),
    (req, res, next) => {
      try {
        controller.member(req, res);
      } catch (error) {
        next(error);
      }
    },
  );
  router.get(
    '/clinics/:clinicId/staff',
    authenticate,
    createRequireClinicRole(auth, ['owner', 'staff']),
    (req, res, next) => {
      try {
        controller.staff(req, res);
      } catch (error) {
        next(error);
      }
    },
  );
  router.get(
    '/clinics/:clinicId/admin',
    authenticate,
    createRequireClinicRole(auth, ['owner']),
    (req, res, next) => {
      try {
        controller.admin(req, res);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
