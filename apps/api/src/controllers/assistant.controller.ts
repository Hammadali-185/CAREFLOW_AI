import type { Request, Response } from 'express';
import type { MembershipRole } from '@careflow/shared';
import type { AssistantService } from '../services/assistant.service.js';
import { parseRequest } from '../validators/parse-request.js';
import {
  assistantMessageRequestSchema,
  assistantSessionParamsSchema,
  assistantSlotRequestSchema,
  confirmAssistantRequestSchema,
} from '../validators/assistant.js';

type ClinicAccess = {
  clinic: { id: string; name: string; slug: string; timezone: string };
  role: MembershipRole;
};

export function createAssistantController(assistant: AssistantService) {
  return {
    async list(req: Request, res: Response) {
      const access = clinicAccess(res);
      const body = await assistant.listSessions(requireUser(req), access.clinic.id);
      res.status(200).json(body);
    },
    async create(req: Request, res: Response) {
      const access = clinicAccess(res);
      const body = await assistant.createSession(requireUser(req), access.clinic);
      res.status(201).json(body);
    },
    async get(req: Request, res: Response) {
      const params = parseRequest(assistantSessionParamsSchema, req.params);
      const body = await assistant.getSession(requireUser(req), params.sessionId);
      res.status(200).json(body);
    },
    async postMessage(req: Request, res: Response) {
      const params = parseRequest(assistantSessionParamsSchema, req.params);
      const input = parseRequest(assistantMessageRequestSchema, req.body);
      const body = await assistant.postMessage(requireUser(req), params.sessionId, input.text);
      res.status(200).json(body);
    },
    async selectSlot(req: Request, res: Response) {
      const params = parseRequest(assistantSessionParamsSchema, req.params);
      const input = parseRequest(assistantSlotRequestSchema, req.body);
      const body = await assistant.selectSlot(requireUser(req), params.sessionId, input);
      res.status(200).json(body);
    },
    async confirm(req: Request, res: Response) {
      const params = parseRequest(assistantSessionParamsSchema, req.params);
      parseRequest(confirmAssistantRequestSchema, req.body);
      const body = await assistant.confirm(requireUser(req), params.sessionId);
      res.status(200).json(body);
    },
  };
}

export type AssistantController = ReturnType<typeof createAssistantController>;

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
