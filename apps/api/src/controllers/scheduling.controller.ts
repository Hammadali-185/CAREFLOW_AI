import { IDEMPOTENCY_HEADER } from '@careflow/shared';
import type { Request, Response } from 'express';
import type { MembershipRole } from '@careflow/shared';
import type { SchedulingService } from '../services/scheduling.service.js';
import { parseRequest } from '../validators/parse-request.js';
import {
  appointmentIdSchema,
  createAppointmentRequestSchema,
  createServiceRequestSchema,
  createTimeOffRequestSchema,
  replaceAvailabilityRequestSchema,
  rescheduleAppointmentRequestSchema,
  scheduleQuerySchema,
  serviceIdParamsSchema,
  slotQuerySchema,
  staffUserParamsSchema,
  timeOffParamsSchema,
  updateServiceRequestSchema,
} from '../validators/scheduling.js';

type ClinicAccess = {
  clinic: { id: string; name: string; slug: string; timezone: string };
  role: MembershipRole;
};

export function createSchedulingController(scheduling: SchedulingService) {
  return {
    async listServices(_req: Request, res: Response) {
      const access = clinicAccess(res);
      const body = await scheduling.listServices(access.clinic.id, access.role);
      res.status(200).json(body);
    },
    async createService(req: Request, res: Response) {
      const access = clinicAccess(res);
      const input = parseRequest(createServiceRequestSchema, req.body);
      const service = await scheduling.createService(access.clinic.id, input);
      res.status(201).json({ service });
    },
    async updateService(req: Request, res: Response) {
      const access = clinicAccess(res);
      const params = parseRequest(serviceIdParamsSchema, req.params);
      const input = parseRequest(updateServiceRequestSchema, req.body);
      const service = await scheduling.updateService(access.clinic.id, params.serviceId, input);
      res.status(200).json({ service });
    },
    async listStaff(_req: Request, res: Response) {
      const access = clinicAccess(res);
      const staff = await scheduling.listStaff(access.clinic.id);
      res.status(200).json({ staff });
    },
    async searchSlots(req: Request, res: Response) {
      const access = clinicAccess(res);
      const query = parseRequest(slotQuerySchema, req.query);
      const body = await scheduling.searchSlots({
        clinicId: access.clinic.id,
        timeZone: access.clinic.timezone,
        serviceId: query.serviceId,
        date: query.date,
        staffUserId: query.staffUserId,
      });
      res.status(200).json(body);
    },
    async createAppointment(req: Request, res: Response) {
      const access = clinicAccess(res);
      const body = parseRequest(createAppointmentRequestSchema, req.body);
      const created = await scheduling.createAppointment({
        clinicId: access.clinic.id,
        timeZone: access.clinic.timezone,
        actorUserId: requireUser(req),
        body,
        idempotencyKey: headerValue(req.get(IDEMPOTENCY_HEADER)),
      });
      res.status(created.replayed ? 200 : 201).json(created);
    },
    async listMine(req: Request, res: Response) {
      const appointments = await scheduling.listMine(requireUser(req));
      res.status(200).json({ appointments });
    },
    async getAppointment(req: Request, res: Response) {
      const params = parseRequest(appointmentIdSchema, req.params);
      const appointment = await scheduling.getAppointment(requireUser(req), params.appointmentId);
      res.status(200).json({ appointment });
    },
    async cancel(req: Request, res: Response) {
      const params = parseRequest(appointmentIdSchema, req.params);
      const appointment = await scheduling.cancel(requireUser(req), params.appointmentId);
      res.status(200).json({ appointment });
    },
    async reschedule(req: Request, res: Response) {
      const params = parseRequest(appointmentIdSchema, req.params);
      const body = parseRequest(rescheduleAppointmentRequestSchema, req.body);
      const appointment = await scheduling.reschedule(requireUser(req), params.appointmentId, body);
      res.status(200).json({ appointment });
    },
    async schedule(req: Request, res: Response) {
      const access = clinicAccess(res);
      const params = parseRequest(staffUserParamsSchema, req.params);
      const query = parseRequest(scheduleQuerySchema, req.query);
      const body = await scheduling.schedule({
        clinicId: access.clinic.id,
        actorUserId: requireUser(req),
        actorRole: access.role,
        staffUserId: params.staffUserId,
        from: query.from,
        to: query.to,
      });
      res.status(200).json(body);
    },
    async getAvailability(req: Request, res: Response) {
      const access = clinicAccess(res);
      const params = parseRequest(staffUserParamsSchema, req.params);
      const body = await scheduling.getAvailability({
        clinicId: access.clinic.id,
        actorUserId: requireUser(req),
        actorRole: access.role,
        staffUserId: params.staffUserId,
      });
      res.status(200).json(body);
    },
    async replaceAvailability(req: Request, res: Response) {
      const access = clinicAccess(res);
      const params = parseRequest(staffUserParamsSchema, req.params);
      const body = parseRequest(replaceAvailabilityRequestSchema, req.body);
      await scheduling.replaceAvailability({
        clinicId: access.clinic.id,
        actorUserId: requireUser(req),
        actorRole: access.role,
        staffUserId: params.staffUserId,
        body,
      });
      res.status(204).end();
    },
    async createTimeOff(req: Request, res: Response) {
      const access = clinicAccess(res);
      const params = parseRequest(staffUserParamsSchema, req.params);
      const body = parseRequest(createTimeOffRequestSchema, req.body);
      const created = await scheduling.createTimeOff({
        clinicId: access.clinic.id,
        actorUserId: requireUser(req),
        actorRole: access.role,
        staffUserId: params.staffUserId,
        body,
      });
      res.status(201).json(created);
    },
    async deleteTimeOff(req: Request, res: Response) {
      const access = clinicAccess(res);
      const params = parseRequest(timeOffParamsSchema, req.params);
      await scheduling.deleteTimeOff({
        clinicId: access.clinic.id,
        actorUserId: requireUser(req),
        actorRole: access.role,
        timeOffId: params.timeOffId,
      });
      res.status(204).end();
    },
  };
}

export type SchedulingController = ReturnType<typeof createSchedulingController>;

function clinicAccess(res: Response) {
  return res.locals.clinicAccess as ClinicAccess;
}

function requireUser(req: Request) {
  const userId = req.auth?.user.id;
  if (!userId) {
    throw new Error('Authentication middleware did not run.');
  }
  return userId;
}

function headerValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
