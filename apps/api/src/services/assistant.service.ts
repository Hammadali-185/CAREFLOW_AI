import type {
  AppointmentRecord,
  AssistantTurn,
  MembershipRole,
  WorkflowState,
} from '@careflow/shared';
import { EMERGENCY_REPLY, looksLikeEmergency } from '../modules/assistant/emergency.js';
import { greetingReply, looksLikeGreeting } from '../modules/assistant/greeting.js';
import {
  MODEL_HISTORY_LIMIT,
  ModelRequestError,
  type ModelClient,
} from '../modules/assistant/model.js';
import { parseModelIntent } from '../modules/assistant/parse-intent.js';
import { buildSystemPrompt } from '../modules/assistant/prompt.js';
import {
  describeBooked,
  describeCancel,
  describeChoices,
  describeReview,
  describeSlots,
  describeVisits,
  slotStillOffered,
  suggestionsFor,
} from '../modules/assistant/replies.js';
import { clinicDate, filterSlots, resolveBookingDetails } from '../modules/assistant/resolve.js';
import { applyExtraction, emptyWorkflow, readWorkflow } from '../modules/assistant/workflow.js';
import { AppError, NotFoundError } from '../errors/app-error.js';
import {
  ConfirmationRequiredError,
  ForbiddenError,
  SlotUnavailableError,
} from '../errors/http-errors.js';
import type {
  AssistantRepository,
  StoredMessage,
  StoredSession,
} from '../repositories/assistant.repository.js';
import type { SchedulingService } from './scheduling.service.js';
import type { Logger } from '../utils/logger.js';

const MESSAGE_LIMIT = 100;
const SLOT_LIMIT = 12;

type Clinic = { id: string; name: string; slug: string; timezone: string };

export type AssistantService = {
  listSessions(
    actorUserId: string,
    clinicId: string,
  ): Promise<{ sessions: AssistantTurn['session'][] }>;
  createSession(actorUserId: string, clinic: Clinic): Promise<AssistantTurn>;
  getSession(actorUserId: string, sessionId: string): Promise<AssistantTurn>;
  postMessage(actorUserId: string, sessionId: string, text: string): Promise<AssistantTurn>;
  selectSlot(
    actorUserId: string,
    sessionId: string,
    input: { staffUserId: string; startsAt: string },
  ): Promise<AssistantTurn>;
  confirm(actorUserId: string, sessionId: string): Promise<AssistantTurn>;
};

export function createAssistantService(deps: {
  repository: AssistantRepository;
  scheduling: SchedulingService;
  model: ModelClient;
  clinicAccess: (
    userId: string,
    clinicId: string,
    allowed: readonly MembershipRole[],
  ) => Promise<{ clinic: Clinic; role: MembershipRole } | null>;
  logger: Logger;
  now?: () => Date;
}): AssistantService {
  const now = deps.now ?? (() => new Date());

  return {
    async listSessions(actorUserId, clinicId) {
      const access = await requireClinic(actorUserId, clinicId);
      const sessions = await deps.repository.listSessions({
        businessId: clinicId,
        participantUserId: actorUserId,
      });
      return {
        sessions: sessions.map((session) => ({
          id: session.id,
          clinicId: session.businessId,
          clinicName: access.clinic.name,
          openedAt: session.openedAt.toISOString(),
          appointmentId: session.appointmentId,
          preview: session.preview,
        })),
      };
    },

    async createSession(actorUserId, clinic) {
      await requireClinic(actorUserId, clinic.id);
      const session = await deps.repository.createSession({
        businessId: clinic.id,
        participantUserId: actorUserId,
      });
      return present({
        session,
        clinic,
        messages: [],
        workflow: emptyWorkflow(),
        outcome: 'loaded',
        appointment: null,
        suggestions: ['Show my visits'],
      });
    },

    async getSession(actorUserId, sessionId) {
      const loaded = await loadOwned(actorUserId, sessionId);
      const appointment = await linkedAppointment(actorUserId, loaded.workflow);
      const names = (await catalogFor(loaded.clinic)).services.map((service) => service.name);
      return present({
        ...loaded,
        outcome: 'loaded',
        appointment,
        suggestions: suggestionsFor(loaded.workflow, names),
      });
    },

    async postMessage(actorUserId, sessionId, text) {
      const loaded = await loadOwned(actorUserId, sessionId);
      await deps.repository.appendMessage({
        businessId: loaded.session.businessId,
        sessionId: loaded.session.id,
        senderKind: 'user',
        senderUserId: actorUserId,
        body: text,
      });

      if (
        looksLikeGreeting(text) &&
        loaded.workflow.phase === 'collecting' &&
        loaded.workflow.selectedSlot === null
      ) {
        return finish(loaded, {
          workflow: {
            ...loaded.workflow,
            phase: 'collecting',
            intent: 'clarify',
            missingFields: ['service', 'date'],
            confirmationState: 'not_required',
          },
          reply: greetingReply(loaded.clinic.name),
          outcome: 'reply',
          interaction: {
            purpose: 'extract_intent',
            model: 'careflow-screen',
            promptTokens: 0,
            completionTokens: 0,
            latencyMs: 0,
            status: 'succeeded',
            errorCode: null,
          },
        });
      }

      if (looksLikeEmergency(text)) {
        return finish(loaded, {
          workflow: {
            ...loaded.workflow,
            phase: 'collecting',
            intent: 'unsupported',
            offeredSlots: [],
            selectedSlot: null,
            confirmationState: 'not_required',
          },
          reply: EMERGENCY_REPLY,
          outcome: 'emergency',
          interaction: {
            purpose: 'emergency_screen',
            model: 'careflow-screen',
            promptTokens: 0,
            completionTokens: 0,
            latencyMs: 0,
            status: 'refused',
            errorCode: null,
          },
        });
      }

      const catalog = await catalogFor(loaded.clinic);
      let completion: Awaited<ReturnType<ModelClient['complete']>>;
      try {
        const history = await deps.repository.listMessages(loaded.session.id, MESSAGE_LIMIT);
        completion = await deps.model.complete({
          system: buildSystemPrompt({
            serviceNames: catalog.services.map((service) => service.name),
            staffNames: catalog.staff.map((person) => person.displayName),
            today: clinicDate(now(), loaded.clinic.timezone),
            timeZone: loaded.clinic.timezone,
            state: loaded.workflow,
          }),
          messages: history
            .filter(
              (message) => message.senderKind === 'user' || message.senderKind === 'assistant',
            )
            .slice(-MODEL_HISTORY_LIMIT)
            .map((message) => ({
              role: message.senderKind === 'user' ? ('user' as const) : ('assistant' as const),
              content: message.body,
            })),
        });
      } catch (error) {
        const failure = error instanceof ModelRequestError ? error : unavailable();
        deps.logger.warn('assistant provider error', {
          purpose: 'extract_intent',
          status: 'failed',
          errorCode: failure.code,
          latencyMs: 0,
        });
        return finish(loaded, {
          workflow: loaded.workflow,
          reply: failure.message,
          outcome: 'unavailable',
          interaction: {
            purpose: 'extract_intent',
            model: 'unavailable',
            promptTokens: 0,
            completionTokens: 0,
            latencyMs: 0,
            status: 'failed',
            errorCode: failure.code,
          },
        });
      }

      deps.logger.info('assistant model', {
        purpose: 'extract_intent',
        model: completion.model,
        latencyMs: completion.latencyMs,
        promptTokens: completion.promptTokens,
        completionTokens: completion.completionTokens,
        status: 'succeeded',
      });

      const parsed = parseModelIntent(completion.content);
      if (!parsed.ok) {
        return finish(loaded, {
          workflow: loaded.workflow,
          reply:
            'I could not read a scheduling request from that reply. Your message is saved. Try again, or use the booking form.',
          outcome: 'invalid_output',
          interaction: metric(completion, 'failed', 'INVALID_OUTPUT'),
        });
      }
      if (parsed.intent.emergency) {
        return finish(loaded, {
          workflow: {
            ...loaded.workflow,
            phase: 'collecting',
            intent: 'unsupported',
            offeredSlots: [],
            selectedSlot: null,
            confirmationState: 'not_required',
          },
          reply: EMERGENCY_REPLY,
          outcome: 'emergency',
          interaction: metric(completion, 'refused', null),
        });
      }

      const applied = applyExtraction(loaded.workflow, parsed.intent);
      const today = clinicDate(now(), loaded.clinic.timezone);
      const details = resolveBookingDetails({
        state: applied.state,
        services: catalog.services,
        staff: catalog.staff,
        today,
      });
      let workflow: WorkflowState = {
        ...applied.state,
        serviceId: details.serviceId,
        date: details.date,
        staffUserId: details.staffUserId,
        missingFields: details.missing,
      };

      const waiting =
        (loaded.workflow.phase === 'awaiting_confirmation' ||
          loaded.workflow.phase === 'awaiting_reschedule_confirmation' ||
          loaded.workflow.phase === 'awaiting_cancel_confirmation') &&
        !applied.preferenceChanged &&
        workflow.intent === loaded.workflow.intent;
      if (waiting) {
        return finish(loaded, {
          workflow: loaded.workflow,
          reply: 'Nothing is saved yet. Use the confirmation card, or tell me what to change.',
          outcome: 'review',
          interaction: metric(completion, 'succeeded', null),
        });
      }

      if (details.question) {
        workflow = { ...workflow, phase: 'collecting', offeredSlots: [], selectedSlot: null };
        return finish(loaded, {
          workflow,
          reply: details.question,
          outcome: 'reply',
          interaction: metric(completion, 'succeeded', null),
        });
      }

      if (workflow.intent === 'list') {
        const visits = await upcoming(actorUserId, loaded.clinic.id);
        return finish(loaded, {
          workflow: { ...workflow, phase: 'collecting', confirmationState: 'not_required' },
          reply: describeVisits(visits, loaded.clinic.timezone),
          outcome: 'listed',
          interaction: metric(completion, 'succeeded', null),
        });
      }

      if (workflow.intent === 'unsupported' || workflow.intent === 'clarify' || !workflow.intent) {
        return finish(loaded, {
          workflow: { ...workflow, phase: 'collecting' },
          reply: 'I can help book, list, cancel, or move a visit. I cannot help with that request.',
          outcome: 'reply',
          interaction: metric(completion, 'succeeded', null),
        });
      }

      if (workflow.intent === 'cancel' || workflow.intent === 'reschedule') {
        const planned = await planChange(actorUserId, loaded.clinic, workflow);
        return finish(loaded, {
          workflow: planned.workflow,
          reply: planned.reply,
          outcome: planned.outcome,
          interaction: metric(completion, 'succeeded', null),
        });
      }

      const searched = await search(loaded.clinic, workflow);
      return finish(loaded, {
        workflow: searched.workflow,
        reply: searched.reply,
        outcome: searched.outcome,
        interaction: metric(completion, 'succeeded', null),
      });
    },

    async selectSlot(actorUserId, sessionId, input) {
      const loaded = await loadOwned(actorUserId, sessionId);
      const choosing =
        loaded.workflow.phase === 'awaiting_slot' ||
        loaded.workflow.phase === 'awaiting_reschedule_slot';
      if (
        !choosing ||
        !slotStillOffered(loaded.workflow.offeredSlots, input.staffUserId, input.startsAt)
      ) {
        throw new SlotUnavailableError();
      }
      const slot = loaded.workflow.offeredSlots.find(
        (item) => item.staffUserId === input.staffUserId && item.startsAt === input.startsAt,
      );
      if (!slot) {
        throw new SlotUnavailableError();
      }
      const label = await lookupServiceName(loaded.clinic.id, loaded.workflow.serviceId);
      const moving = loaded.workflow.phase === 'awaiting_reschedule_slot';
      const workflow: WorkflowState = {
        ...loaded.workflow,
        selectedSlot: slot,
        phase: moving ? 'awaiting_reschedule_confirmation' : 'awaiting_confirmation',
        confirmationState: 'required',
      };
      const reply = describeReview({
        clinicName: loaded.clinic.name,
        serviceName: label,
        staffName: slot.staffName,
        startsAt: slot.startsAt,
        timeZone: loaded.clinic.timezone,
        moving,
      });
      await deps.repository.saveWorkflow(loaded.session.id, workflow);
      await deps.repository.appendMessage({
        businessId: loaded.session.businessId,
        sessionId: loaded.session.id,
        senderKind: 'assistant',
        senderUserId: null,
        body: reply,
      });
      return present({
        ...loaded,
        workflow,
        messages: await deps.repository.listMessages(loaded.session.id, MESSAGE_LIMIT),
        outcome: 'review',
        appointment: null,
        suggestions: [],
      });
    },

    async confirm(actorUserId, sessionId) {
      const loaded = await loadOwned(actorUserId, sessionId);
      if (loaded.workflow.phase === 'completed' && loaded.workflow.appointmentId) {
        const appointment = await deps.scheduling.getAppointment(
          actorUserId,
          loaded.workflow.appointmentId,
        );
        return present({ ...loaded, outcome: 'booked', appointment, suggestions: [] });
      }

      try {
        if (
          loaded.workflow.phase === 'awaiting_confirmation' &&
          loaded.workflow.selectedSlot &&
          loaded.workflow.serviceId
        ) {
          const created = await deps.scheduling.createAppointment({
            clinicId: loaded.clinic.id,
            timeZone: loaded.clinic.timezone,
            actorUserId,
            body: {
              serviceId: loaded.workflow.serviceId,
              staffUserId: loaded.workflow.selectedSlot.staffUserId,
              startsAt: loaded.workflow.selectedSlot.startsAt,
            },
            idempotencyKey: assistantKey(loaded.session.id, loaded.workflow.selectedSlot.startsAt),
          });
          return commit(loaded, created.appointment, 'booked', false);
        }
        if (
          loaded.workflow.phase === 'awaiting_cancel_confirmation' &&
          loaded.workflow.appointmentId
        ) {
          const appointment = await deps.scheduling.cancel(
            actorUserId,
            loaded.workflow.appointmentId,
          );
          return commit(loaded, appointment, 'cancelled', false);
        }
        if (
          loaded.workflow.phase === 'awaiting_reschedule_confirmation' &&
          loaded.workflow.appointmentId &&
          loaded.workflow.selectedSlot
        ) {
          const appointment = await deps.scheduling.reschedule(
            actorUserId,
            loaded.workflow.appointmentId,
            {
              staffUserId: loaded.workflow.selectedSlot.staffUserId,
              startsAt: loaded.workflow.selectedSlot.startsAt,
            },
          );
          return commit(loaded, appointment, 'rescheduled', true);
        }
      } catch (error) {
        const recovered = await recover(loaded, error);
        if (recovered) {
          return recovered;
        }
        throw error;
      }

      throw new ConfirmationRequiredError();
    },
  };

  async function commit(
    loaded: Owned,
    appointment: AppointmentRecord,
    outcome: 'booked' | 'cancelled' | 'rescheduled',
    moved: boolean,
  ) {
    const workflow: WorkflowState = {
      ...loaded.workflow,
      phase: 'completed',
      appointmentId: appointment.id,
      confirmationState: 'not_required',
      selectedSlot: null,
      offeredSlots: [],
    };
    const reply = describeBooked(appointment, loaded.clinic.timezone, moved);
    await deps.repository.saveWorkflow(loaded.session.id, workflow, appointment.id);
    await deps.repository.appendMessage({
      businessId: loaded.session.businessId,
      sessionId: loaded.session.id,
      senderKind: 'assistant',
      senderUserId: null,
      body: reply,
    });
    return present({
      ...loaded,
      session: { ...loaded.session, appointmentId: appointment.id },
      workflow,
      messages: await deps.repository.listMessages(loaded.session.id, MESSAGE_LIMIT),
      outcome,
      appointment,
      suggestions: [],
    });
  }

  async function recover(loaded: Owned, error: unknown) {
    if (!(error instanceof AppError) || error.statusCode >= 500) {
      return null;
    }
    if (
      error.code !== 'SLOT_TAKEN' &&
      error.code !== 'SLOT_UNAVAILABLE' &&
      error.code !== 'NOT_ELIGIBLE'
    ) {
      return null;
    }
    const workflow: WorkflowState = {
      ...loaded.workflow,
      phase: loaded.workflow.intent === 'reschedule' ? 'awaiting_reschedule_slot' : 'awaiting_slot',
      selectedSlot: null,
      confirmationState: 'required',
    };
    const searched =
      workflow.serviceId && workflow.date ? await search(loaded.clinic, workflow) : null;
    const next = searched?.workflow ?? workflow;
    const reply = searched ? `${error.message}\n${searched.reply}` : error.message;
    await deps.repository.saveWorkflow(loaded.session.id, next);
    await deps.repository.appendMessage({
      businessId: loaded.session.businessId,
      sessionId: loaded.session.id,
      senderKind: 'assistant',
      senderUserId: null,
      body: reply,
    });
    return present({
      ...loaded,
      workflow: next,
      messages: await deps.repository.listMessages(loaded.session.id, MESSAGE_LIMIT),
      outcome: 'slots',
      appointment: null,
      suggestions: [],
    });
  }

  async function finish(
    loaded: Owned,
    input: {
      workflow: WorkflowState;
      reply: string;
      outcome: AssistantTurn['outcome'];
      interaction: Interaction;
    },
  ) {
    await deps.repository.saveWorkflow(loaded.session.id, input.workflow);
    await deps.repository.appendMessage({
      businessId: loaded.session.businessId,
      sessionId: loaded.session.id,
      senderKind: 'assistant',
      senderUserId: null,
      body: input.reply,
    });
    await deps.repository.recordInteraction({
      businessId: loaded.session.businessId,
      actorUserId: loaded.session.participantUserId,
      chatSessionId: loaded.session.id,
      ...input.interaction,
    });
    const names = (await catalogFor(loaded.clinic)).services.map((service) => service.name);
    return present({
      ...loaded,
      workflow: input.workflow,
      messages: await deps.repository.listMessages(loaded.session.id, MESSAGE_LIMIT),
      outcome: input.outcome,
      appointment: null,
      suggestions: suggestionsFor(input.workflow, names),
    });
  }

  async function planChange(
    actorUserId: string,
    clinic: Clinic,
    workflow: WorkflowState,
  ): Promise<Planned> {
    const visits = await upcoming(actorUserId, clinic.id);
    const matched = visits.filter((visit) => {
      const sameService = workflow.serviceId ? visit.serviceId === workflow.serviceId : true;
      if (workflow.intent === 'reschedule') {
        return sameService;
      }
      const sameDay = workflow.date
        ? clinicDate(new Date(visit.startsAt), clinic.timezone) === workflow.date
        : true;
      return sameDay && sameService;
    });
    const action = workflow.intent === 'cancel' ? 'cancel' : 'move';
    if (matched.length !== 1) {
      const pool = matched.length > 1 ? matched : visits;
      return {
        workflow: {
          ...workflow,
          phase: 'collecting' as const,
          appointmentId: null,
          missingFields: ['appointment' as const],
        },
        reply:
          pool.length === 0
            ? 'You have no upcoming visit that can be changed.'
            : describeChoices(pool, clinic.timezone, action),
        outcome: 'reply' as const,
      };
    }
    const visit = matched[0];
    if (!visit) {
      return {
        workflow,
        reply: 'You have no upcoming visit that can be changed.',
        outcome: 'reply' as const,
      };
    }
    if (workflow.intent === 'cancel') {
      return {
        workflow: {
          ...workflow,
          phase: 'awaiting_cancel_confirmation' as const,
          appointmentId: visit.id,
          serviceId: visit.serviceId,
          confirmationState: 'required' as const,
        },
        reply: describeCancel(visit, clinic.timezone),
        outcome: 'review' as const,
      };
    }
    const next: WorkflowState = {
      ...workflow,
      appointmentId: visit.id,
      serviceId: visit.serviceId,
      confirmationState: 'required',
    };
    if (!next.date) {
      return {
        workflow: { ...next, phase: 'collecting', missingFields: ['date'] },
        reply: 'Which day should I move that visit to?',
        outcome: 'reply' as const,
      };
    }
    return search(clinic, next);
  }

  async function search(clinic: Clinic, workflow: WorkflowState): Promise<Planned> {
    if (!workflow.serviceId || !workflow.date) {
      return {
        workflow: { ...workflow, phase: 'collecting' as const },
        reply: 'I still need a service and a day before I can look up open times.',
        outcome: 'reply' as const,
      };
    }
    try {
      const result = await deps.scheduling.searchSlots({
        clinicId: clinic.id,
        timeZone: clinic.timezone,
        serviceId: workflow.serviceId,
        date: workflow.date,
        staffUserId: workflow.staffUserId ?? undefined,
      });
      const filtered = filterSlots(result.slots, workflow.timePreference, clinic.timezone);
      if (filtered.unclear) {
        return {
          workflow: { ...workflow, phase: 'collecting' as const, missingFields: ['time' as const] },
          reply: 'What time of day works, such as morning or 2:00 PM?',
          outcome: 'reply' as const,
        };
      }
      const slots = filtered.slots.slice(0, SLOT_LIMIT);
      const service = await lookupServiceName(clinic.id, workflow.serviceId);
      const moving = workflow.intent === 'reschedule';
      return {
        workflow: {
          ...workflow,
          offeredSlots: slots,
          selectedSlot: null,
          phase: moving ? ('awaiting_reschedule_slot' as const) : ('awaiting_slot' as const),
          confirmationState: 'required' as const,
        },
        reply: describeSlots({
          closed: result.closed,
          relaxed: filtered.relaxed,
          slots,
          timeZone: clinic.timezone,
          serviceName: service,
          date: workflow.date,
        }),
        outcome: slots.length > 0 ? ('slots' as const) : ('reply' as const),
      };
    } catch (error) {
      if (error instanceof AppError && error.statusCode < 500) {
        return {
          workflow: {
            ...workflow,
            phase: 'collecting' as const,
            offeredSlots: [],
            selectedSlot: null,
          },
          reply: error.message,
          outcome: 'reply' as const,
        };
      }
      throw error;
    }
  }

  async function upcoming(actorUserId: string, clinicId: string) {
    const mine = await deps.scheduling.listMine(actorUserId);
    return mine.filter(
      (visit) =>
        visit.clinicId === clinicId &&
        (visit.status === 'requested' || visit.status === 'confirmed') &&
        new Date(visit.startsAt).getTime() > now().getTime(),
    );
  }

  async function lookupServiceName(clinicId: string, serviceId: string | null) {
    if (!serviceId) {
      return 'the visit';
    }
    const listed = await deps.scheduling.listServices(clinicId, 'patient');
    return listed.services.find((service) => service.id === serviceId)?.name ?? 'the visit';
  }

  async function catalogFor(clinic: Clinic) {
    const listed = await deps.scheduling.listServices(clinic.id, 'patient');
    const staff = await deps.scheduling.listStaff(clinic.id);
    return { services: listed.services, staff };
  }

  async function requireClinic(actorUserId: string, clinicId: string) {
    const access = await deps.clinicAccess(actorUserId, clinicId, ['patient']);
    if (!access) {
      throw new ForbiddenError();
    }
    return access;
  }

  async function loadOwned(actorUserId: string, sessionId: string): Promise<Owned> {
    const session = await deps.repository.findSession(sessionId);
    if (!session) {
      throw new NotFoundError('That conversation was not found.');
    }
    if (session.participantUserId !== actorUserId) {
      throw new ForbiddenError();
    }
    const access = await requireClinic(actorUserId, session.businessId);
    const messages = await deps.repository.listMessages(session.id, MESSAGE_LIMIT);
    return {
      session,
      clinic: access.clinic,
      messages,
      workflow: readWorkflow(session.workflowState),
    };
  }

  async function linkedAppointment(actorUserId: string, workflow: WorkflowState) {
    if (!workflow.appointmentId || workflow.phase !== 'completed') {
      return null;
    }
    try {
      return await deps.scheduling.getAppointment(actorUserId, workflow.appointmentId);
    } catch {
      return null;
    }
  }
}

type Planned = {
  workflow: WorkflowState;
  reply: string;
  outcome: AssistantTurn['outcome'];
};

type Owned = {
  session: StoredSession;
  clinic: Clinic;
  messages: StoredMessage[];
  workflow: WorkflowState;
};

type Interaction = {
  purpose: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  status: 'succeeded' | 'failed' | 'refused';
  errorCode: string | null;
};

function present(
  input: Owned & {
    outcome: AssistantTurn['outcome'];
    appointment: AppointmentRecord | null;
    suggestions: string[];
  },
): AssistantTurn {
  return {
    session: {
      id: input.session.id,
      clinicId: input.session.businessId,
      clinicName: input.clinic.name,
      openedAt: input.session.openedAt.toISOString(),
      appointmentId: input.session.appointmentId,
      preview: input.messages.at(-1)?.body.slice(0, 80) ?? null,
    },
    messages: input.messages.map((message) => ({
      id: message.id,
      senderKind: message.senderKind,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
    })),
    workflow: input.workflow,
    suggestions: input.suggestions,
    outcome: input.outcome,
    appointment: input.appointment,
    manualBooking: {
      serviceId: input.workflow.serviceId,
      date: input.workflow.date,
    },
  };
}

function metric(
  completion: { model: string; promptTokens: number; completionTokens: number; latencyMs: number },
  status: Interaction['status'],
  errorCode: string | null,
): Interaction {
  return {
    purpose: 'extract_intent',
    model: completion.model,
    promptTokens: completion.promptTokens,
    completionTokens: completion.completionTokens,
    latencyMs: completion.latencyMs,
    status,
    errorCode,
  };
}

function unavailable() {
  return new ModelRequestError(
    'UNAVAILABLE',
    'The scheduling assistant is unavailable. You can book from the form.',
  );
}

function assistantKey(sessionId: string, startsAt: string) {
  const compact = sessionId.replace(/-/g, '');
  const stamp = String(new Date(startsAt).getTime());
  return `asst${compact}${stamp}`.slice(0, 80);
}
