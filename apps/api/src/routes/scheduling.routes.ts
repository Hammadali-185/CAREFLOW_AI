import { Router } from 'express';
import type { SchedulingController } from '../controllers/scheduling.controller.js';
import type { NodeEnv } from '../config/env.js';
import {
  createAuthenticate,
  createRequireClinicRole,
  createRequireCsrf,
} from '../middleware/security.js';
import type { AuthService } from '../services/auth.service.js';

export function createSchedulingRouter(
  controller: SchedulingController,
  auth: AuthService,
  nodeEnv: NodeEnv,
) {
  const router = Router();
  const authenticate = createAuthenticate(auth, nodeEnv);
  const requireCsrf = createRequireCsrf(auth);
  const members = createRequireClinicRole(auth, ['owner', 'staff', 'patient']);
  const staff = createRequireClinicRole(auth, ['owner', 'staff']);
  const patients = createRequireClinicRole(auth, ['patient']);

  router.get('/clinics/:clinicId/services', authenticate, members, (req, res, next) => {
    controller.listServices(req, res).catch(next);
  });
  router.post('/clinics/:clinicId/services', authenticate, requireCsrf, staff, (req, res, next) => {
    controller.createService(req, res).catch(next);
  });
  router.patch(
    '/clinics/:clinicId/services/:serviceId',
    authenticate,
    requireCsrf,
    staff,
    (req, res, next) => {
      controller.updateService(req, res).catch(next);
    },
  );
  router.get('/clinics/:clinicId/staff-members', authenticate, members, (req, res, next) => {
    controller.listStaff(req, res).catch(next);
  });
  router.get('/clinics/:clinicId/slots', authenticate, members, (req, res, next) => {
    controller.searchSlots(req, res).catch(next);
  });
  router.post(
    '/clinics/:clinicId/appointments',
    authenticate,
    requireCsrf,
    patients,
    (req, res, next) => {
      controller.createAppointment(req, res).catch(next);
    },
  );
  router.get('/appointments', authenticate, (req, res, next) => {
    controller.listMine(req, res).catch(next);
  });
  router.get('/appointments/:appointmentId', authenticate, (req, res, next) => {
    controller.getAppointment(req, res).catch(next);
  });
  router.post(
    '/appointments/:appointmentId/cancel',
    authenticate,
    requireCsrf,
    (req, res, next) => {
      controller.cancel(req, res).catch(next);
    },
  );
  router.post(
    '/appointments/:appointmentId/reschedule',
    authenticate,
    requireCsrf,
    (req, res, next) => {
      controller.reschedule(req, res).catch(next);
    },
  );
  router.get(
    '/clinics/:clinicId/staff/:staffUserId/schedule',
    authenticate,
    staff,
    (req, res, next) => {
      controller.schedule(req, res).catch(next);
    },
  );
  router.get(
    '/clinics/:clinicId/staff/:staffUserId/availability',
    authenticate,
    staff,
    (req, res, next) => {
      controller.getAvailability(req, res).catch(next);
    },
  );
  router.put(
    '/clinics/:clinicId/staff/:staffUserId/availability',
    authenticate,
    requireCsrf,
    staff,
    (req, res, next) => {
      controller.replaceAvailability(req, res).catch(next);
    },
  );
  router.post(
    '/clinics/:clinicId/staff/:staffUserId/time-off',
    authenticate,
    requireCsrf,
    staff,
    (req, res, next) => {
      controller.createTimeOff(req, res).catch(next);
    },
  );
  router.delete(
    '/clinics/:clinicId/time-off/:timeOffId',
    authenticate,
    requireCsrf,
    staff,
    (req, res, next) => {
      controller.deleteTimeOff(req, res).catch(next);
    },
  );

  return router;
}
