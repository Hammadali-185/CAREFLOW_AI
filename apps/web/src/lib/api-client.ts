import {
  CARE_FLOW_REQUEST_HEADER,
  CSRF_HEADER,
  IDEMPOTENCY_HEADER,
  assistantSessionListSchema,
  assistantTurnSchema,
  appointmentListResponseSchema,
  appointmentResponseSchema,
  authSessionResponseSchema,
  availabilityResponseSchema,
  clinicSessionResponseSchema,
  errorResponseSchema,
  healthResponseSchema,
  readinessResponseSchema,
  scheduleResponseSchema,
  serviceListResponseSchema,
  serviceSchema,
  slotSearchResponseSchema,
  staffListResponseSchema,
  type AssistantSessionList,
  type AssistantTurn,
  type AppointmentRecord,
  type AuthSessionResponse,
  type AvailabilityResponse,
  type ClinicSessionResponse,
  type CreateAppointmentRequest,
  type CreateServiceRequest,
  type CreateTimeOffRequest,
  type UpdateServiceRequest,
  type HealthResponse,
  type LoginRequest,
  type ReadinessResponse,
  type ReplaceAvailabilityRequest,
  type RescheduleAppointmentRequest,
  type ScheduleResponse,
  type ServiceRecord,
  type SignupRequest,
  type SlotSearchResponse,
  type StaffMember,
} from '@careflow/shared';
import { z } from 'zod';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = 'REQUEST_FAILED') {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export type ApiClient = {
  baseUrl: string;
  setUnauthorizedHandler: (handler: () => void) => void;
  health: (signal?: AbortSignal) => Promise<HealthResponse>;
  readiness: (signal?: AbortSignal) => Promise<ReadinessResponse>;
  currentUser: (signal?: AbortSignal) => Promise<AuthSessionResponse | null>;
  login: (input: LoginRequest) => Promise<AuthSessionResponse>;
  signup: (input: SignupRequest) => Promise<AuthSessionResponse>;
  logout: (csrfToken: string) => Promise<void>;
  clinic: (clinicId: string, signal?: AbortSignal) => Promise<ClinicSessionResponse>;
  listServices: (clinicId: string, signal?: AbortSignal) => Promise<ServiceRecord[]>;
  listStaff: (clinicId: string, signal?: AbortSignal) => Promise<StaffMember[]>;
  searchSlots: (
    clinicId: string,
    query: { serviceId: string; date: string; staffUserId?: string },
    signal?: AbortSignal,
  ) => Promise<SlotSearchResponse>;
  createAppointment: (
    clinicId: string,
    body: CreateAppointmentRequest,
    csrfToken: string,
    idempotencyKey: string,
  ) => Promise<{ appointment: AppointmentRecord; replayed: boolean }>;
  listAppointments: (signal?: AbortSignal) => Promise<AppointmentRecord[]>;
  cancelAppointment: (appointmentId: string, csrfToken: string) => Promise<AppointmentRecord>;
  rescheduleAppointment: (
    appointmentId: string,
    body: RescheduleAppointmentRequest,
    csrfToken: string,
  ) => Promise<AppointmentRecord>;
  createService: (
    clinicId: string,
    body: CreateServiceRequest,
    csrfToken: string,
  ) => Promise<ServiceRecord>;
  updateService: (
    clinicId: string,
    serviceId: string,
    body: UpdateServiceRequest,
    csrfToken: string,
  ) => Promise<ServiceRecord>;
  schedule: (
    clinicId: string,
    staffUserId: string,
    query: { from: string; to: string },
    signal?: AbortSignal,
  ) => Promise<ScheduleResponse>;
  availability: (
    clinicId: string,
    staffUserId: string,
    signal?: AbortSignal,
  ) => Promise<AvailabilityResponse>;
  replaceAvailability: (
    clinicId: string,
    staffUserId: string,
    body: ReplaceAvailabilityRequest,
    csrfToken: string,
  ) => Promise<void>;
  createTimeOff: (
    clinicId: string,
    staffUserId: string,
    body: CreateTimeOffRequest,
    csrfToken: string,
  ) => Promise<{ id: string }>;
  deleteTimeOff: (clinicId: string, timeOffId: string, csrfToken: string) => Promise<void>;
  listAssistantSessions: (clinicId: string, signal?: AbortSignal) => Promise<AssistantSessionList>;
  createAssistantSession: (clinicId: string, csrfToken: string) => Promise<AssistantTurn>;
  getAssistantSession: (sessionId: string, signal?: AbortSignal) => Promise<AssistantTurn>;
  postAssistantMessage: (
    sessionId: string,
    text: string,
    csrfToken: string,
  ) => Promise<AssistantTurn>;
  selectAssistantSlot: (
    sessionId: string,
    slot: { staffUserId: string; startsAt: string },
    csrfToken: string,
  ) => Promise<AssistantTurn>;
  confirmAssistant: (sessionId: string, csrfToken: string) => Promise<AssistantTurn>;
};

export function createApiClient(baseUrl: string): ApiClient {
  const root = baseUrl.replace(/\/$/, '');
  let onUnauthorized = () => {};

  function reportUnauthorized(path: string, status: number) {
    if (
      status === 401 &&
      path !== '/api/auth/login' &&
      path !== '/api/auth/signup' &&
      path !== '/api/auth/me'
    ) {
      onUnauthorized();
    }
  }

  return {
    baseUrl: root,
    setUnauthorizedHandler(handler) {
      onUnauthorized = handler;
    },
    health(signal) {
      return send(
        root,
        '/api/health',
        { method: 'GET', signal, schema: healthResponseSchema },
        reportUnauthorized,
      );
    },
    readiness(signal) {
      return send(
        root,
        '/api/ready',
        { method: 'GET', signal, schema: readinessResponseSchema, allowedStatuses: [503] },
        reportUnauthorized,
      );
    },
    async currentUser(signal) {
      try {
        return await send(
          root,
          '/api/auth/me',
          { method: 'GET', signal, schema: authSessionResponseSchema },
          reportUnauthorized,
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          return null;
        }
        throw error;
      }
    },
    login(input) {
      return send(
        root,
        '/api/auth/login',
        { method: 'POST', body: input, schema: authSessionResponseSchema },
        reportUnauthorized,
      );
    },
    signup(input) {
      return send(
        root,
        '/api/auth/signup',
        { method: 'POST', body: input, schema: authSessionResponseSchema },
        reportUnauthorized,
      );
    },
    async logout(csrfToken) {
      await send(
        root,
        '/api/auth/logout',
        { method: 'POST', csrfToken, expectEmpty: true },
        reportUnauthorized,
      );
    },
    clinic(clinicId, signal) {
      return send(
        root,
        `/api/clinics/${clinicId}`,
        { method: 'GET', signal, schema: clinicSessionResponseSchema },
        reportUnauthorized,
      );
    },
    async listServices(clinicId, signal) {
      const body = await send(
        root,
        `/api/clinics/${clinicId}/services`,
        { method: 'GET', signal, schema: serviceListResponseSchema },
        reportUnauthorized,
      );
      return body.services;
    },
    async listStaff(clinicId, signal) {
      const body = await send(
        root,
        `/api/clinics/${clinicId}/staff-members`,
        { method: 'GET', signal, schema: staffListResponseSchema },
        reportUnauthorized,
      );
      return body.staff;
    },
    searchSlots(clinicId, query, signal) {
      return send(
        root,
        `/api/clinics/${clinicId}/slots`,
        {
          method: 'GET',
          signal,
          query,
          schema: slotSearchResponseSchema,
        },
        reportUnauthorized,
      );
    },
    async createAppointment(clinicId, body, csrfToken, idempotencyKey) {
      const created = await send(
        root,
        `/api/clinics/${clinicId}/appointments`,
        {
          method: 'POST',
          body,
          csrfToken,
          headers: { [IDEMPOTENCY_HEADER]: idempotencyKey },
          schema: appointmentResponseSchema,
        },
        reportUnauthorized,
      );
      return { appointment: created.appointment, replayed: created.replayed ?? false };
    },
    async listAppointments(signal) {
      const body = await send(
        root,
        '/api/appointments',
        { method: 'GET', signal, schema: appointmentListResponseSchema },
        reportUnauthorized,
      );
      return body.appointments;
    },
    async cancelAppointment(appointmentId, csrfToken) {
      const body = await send(
        root,
        `/api/appointments/${appointmentId}/cancel`,
        { method: 'POST', csrfToken, schema: appointmentResponseSchema },
        reportUnauthorized,
      );
      return body.appointment;
    },
    async rescheduleAppointment(appointmentId, body, csrfToken) {
      const moved = await send(
        root,
        `/api/appointments/${appointmentId}/reschedule`,
        { method: 'POST', body, csrfToken, schema: appointmentResponseSchema },
        reportUnauthorized,
      );
      return moved.appointment;
    },
    async createService(clinicId, body, csrfToken) {
      const created = await send(
        root,
        `/api/clinics/${clinicId}/services`,
        {
          method: 'POST',
          body,
          csrfToken,
          schema: z.object({ service: serviceSchema }),
        },
        reportUnauthorized,
      );
      return created.service;
    },
    async updateService(clinicId, serviceId, body, csrfToken) {
      const updated = await send(
        root,
        `/api/clinics/${clinicId}/services/${serviceId}`,
        {
          method: 'PATCH',
          body,
          csrfToken,
          schema: z.object({ service: serviceSchema }),
        },
        reportUnauthorized,
      );
      return updated.service;
    },
    schedule(clinicId, staffUserId, query, signal) {
      return send(
        root,
        `/api/clinics/${clinicId}/staff/${staffUserId}/schedule`,
        { method: 'GET', signal, query, schema: scheduleResponseSchema },
        reportUnauthorized,
      );
    },
    availability(clinicId, staffUserId, signal) {
      return send(
        root,
        `/api/clinics/${clinicId}/staff/${staffUserId}/availability`,
        { method: 'GET', signal, schema: availabilityResponseSchema },
        reportUnauthorized,
      );
    },
    async replaceAvailability(clinicId, staffUserId, body, csrfToken) {
      await send(
        root,
        `/api/clinics/${clinicId}/staff/${staffUserId}/availability`,
        { method: 'PUT', body, csrfToken, expectEmpty: true },
        reportUnauthorized,
      );
    },
    createTimeOff(clinicId, staffUserId, body, csrfToken) {
      return send(
        root,
        `/api/clinics/${clinicId}/staff/${staffUserId}/time-off`,
        {
          method: 'POST',
          body,
          csrfToken,
          schema: z.object({ id: z.uuid() }),
        },
        reportUnauthorized,
      );
    },
    async deleteTimeOff(clinicId, timeOffId, csrfToken) {
      await send(
        root,
        `/api/clinics/${clinicId}/time-off/${timeOffId}`,
        { method: 'DELETE', csrfToken, expectEmpty: true },
        reportUnauthorized,
      );
    },
    listAssistantSessions(clinicId, signal) {
      return send(
        root,
        `/api/clinics/${clinicId}/assistant/sessions`,
        { method: 'GET', signal, schema: assistantSessionListSchema },
        reportUnauthorized,
      );
    },
    createAssistantSession(clinicId, csrfToken) {
      return send(
        root,
        `/api/clinics/${clinicId}/assistant/sessions`,
        { method: 'POST', body: {}, csrfToken, schema: assistantTurnSchema },
        reportUnauthorized,
      );
    },
    getAssistantSession(sessionId, signal) {
      return send(
        root,
        `/api/assistant/sessions/${sessionId}`,
        { method: 'GET', signal, schema: assistantTurnSchema },
        reportUnauthorized,
      );
    },
    postAssistantMessage(sessionId, text, csrfToken) {
      return send(
        root,
        `/api/assistant/sessions/${sessionId}/messages`,
        { method: 'POST', body: { text }, csrfToken, schema: assistantTurnSchema },
        reportUnauthorized,
      );
    },
    selectAssistantSlot(sessionId, slot, csrfToken) {
      return send(
        root,
        `/api/assistant/sessions/${sessionId}/slots`,
        { method: 'POST', body: slot, csrfToken, schema: assistantTurnSchema },
        reportUnauthorized,
      );
    },
    confirmAssistant(sessionId, csrfToken) {
      return send(
        root,
        `/api/assistant/sessions/${sessionId}/confirm`,
        { method: 'POST', body: { confirmed: true }, csrfToken, schema: assistantTurnSchema },
        reportUnauthorized,
      );
    },
  };
}

async function send<T>(
  root: string,
  path: string,
  options: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    csrfToken?: string;
    headers?: Record<string, string>;
    query?: Record<string, string | undefined>;
    signal?: AbortSignal;
    schema?: z.ZodType<T>;
    allowedStatuses?: number[];
    expectEmpty?: boolean;
  },
  reportUnauthorized: (path: string, status: number) => void,
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  if (options.method !== 'GET') {
    headers.set(CARE_FLOW_REQUEST_HEADER, '1');
  }
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  if (options.csrfToken) {
    headers.set(CSRF_HEADER, options.csrfToken);
  }
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    headers.set(name, value);
  }

  let response: Response;
  try {
    response = await fetch(`${root}${withQuery(path, options.query)}`, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'include',
      signal: options.signal,
    });
  } catch {
    throw new ApiError('The API could not be reached. Start it with npm run dev:api.', 0);
  }

  reportUnauthorized(path, response.status);

  if (options.expectEmpty) {
    if (!response.ok) {
      throw await errorFrom(response);
    }
    return undefined as T;
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // A non-JSON body stays null and fails schema parsing below.
  }

  if (!response.ok && !options.allowedStatuses?.includes(response.status)) {
    throw await errorFrom(response, body);
  }

  const parsed = options.schema?.safeParse(body);
  if (!parsed?.success) {
    throw new ApiError('The API returned an unexpected response.', response.status);
  }

  return parsed.data;
}

function withQuery(path: string, query: Record<string, string | undefined> | undefined) {
  if (!query) {
    return path;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) {
      params.set(key, value);
    }
  }
  const text = params.toString();
  return text ? `${path}?${text}` : path;
}

async function errorFrom(response: Response, body?: unknown): Promise<ApiError> {
  let parsedBody = body;
  if (parsedBody === undefined) {
    try {
      parsedBody = await response.json();
    } catch {
      parsedBody = null;
    }
  }
  const parsed = errorResponseSchema.safeParse(parsedBody);
  if (!parsed.success) {
    return new ApiError(`The API returned status ${response.status}.`, response.status);
  }
  return new ApiError(parsed.data.error.message, response.status, parsed.data.error.code);
}
