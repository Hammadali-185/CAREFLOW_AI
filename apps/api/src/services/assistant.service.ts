import { randomUUID } from 'node:crypto';
import type {
  AppointmentRecord,
  AssistantTurn,
  MembershipRole,
  ModelIntent,
  WorkflowState,
} from '@careflow/shared';
import { EMERGENCY_REPLY, looksLikeEmergency } from '../modules/assistant/emergency.js';
import { greetingReply, looksLikeGreeting } from '../modules/assistant/greeting.js';
import { groundMessage } from '../modules/assistant/ground.js';
import {
  MODEL_HISTORY_LIMIT,
  ModelRequestError,
  type ModelClient,
} from '../modules/assistant/model.js';
import { parseModelIntent } from '../modules/assistant/parse-intent.js';
import { buildSystemPrompt } from '../modules/assistant/prompt.js';
import { absorbContactFromText } from '../modules/assistant/contact.js';
import {
  askForContact,
  describeBooked,
  describeCancel,
  describeChoices,
  describeLimits,
  describePolicy,
  describeReview,
  describeSchedule,
  describeServices,
  describeSlots,
  describeVisits,
  slotStillOffered,
  suggestionsFor,
} from '../modules/assistant/replies.js';
import { clinicDate, filterSlots, resolveBookingDetails } from '../modules/assistant/resolve.js';
import {
  applyExtraction,
  contactMissing,
  emptyWorkflow,
  readWorkflow,
} from '../modules/assistant/workflow.js';
import { AppError, NotFoundError } from '../errors/app-error.js';
import {
  ConfirmationRequiredError,
  ForbiddenError,
  SlotUnavailableError,
} from '../errors/http-errors.js';
import type {
  AssistantRepository,
  LockedSession,
  StoredMessage,
  StoredSession,
} from '../repositories/assistant.repository.js';
import type { SchedulingService } from './scheduling.service.js';
import type { Logger } from '../utils/logger.js';

const MESSAGE_LIMIT = 100;
const SLOT_LIMIT = 12;
export const TURN_CLAIM_TTL_MS = 90_000;
const TURN_WAIT_MS = 20_000;
const TURN_POLL_MS = 200;

type Clinic = { id: string; name: string; slug: string; timezone: string };

export type AssistantService = {
  listSessions(
    actorUserId: string,
    clinicId: string,
  ): Promise<{ sessions: AssistantTurn['session'][] }>;
  createSession(actorUserId: string, clinic: Clinic): Promise<AssistantTurn>;
  getSession(actorUserId: string, sessionId: string): Promise<AssistantTurn>;
  postMessage(
    actorUserId: string,
    sessionId: string,
    text: string,
    options?: { retry?: boolean; turnKey?: string },
  ): Promise<AssistantTurn>;
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
  onTurnWait?: (sessionId: string) => void;
  beforeTurnPersist?: () => Promise<void>;
  beforeWorkflowSave?: () => Promise<void>;
}): AssistantService {
  const now = deps.now ?? (() => new Date());
  const turnWaiters = new Map<string, Array<() => void>>();

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

    async postMessage(actorUserId, sessionId, text, options) {
      const initial = await loadOwned(actorUserId, sessionId);
      const decision = await claimTurn(actorUserId, initial, text, options);
      if (decision.kind === 'replay') {
        return replayTurn(actorUserId, decision.loaded);
      }
      if (decision.kind === 'wait') {
        const followed = await followTurn(actorUserId, decision.loaded);
        if (followed) {
          return followed;
        }
        return processingTurn(decision.loaded);
      }
      if (decision.kind === 'busy') {
        return processingTurn(decision.loaded);
      }
      const loaded = decision.loaded;
      try {
        return await answerTurn(actorUserId, loaded, text);
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        notifyTurn(loaded.session.id);
        deps.logger.warn('assistant turn was not saved', {
          purpose: 'extract_intent',
          status: 'failed',
          errorCode: 'TURN_PERSIST',
        });
        return processingTurn(await loadOwned(actorUserId, sessionId));
      }
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
      const drafted = draftSlotSelection(loaded.workflow, slot, moving);
      const reply = await reviewOrContactReply(loaded, drafted, label, moving);
      const outcome = drafted.phase === 'awaiting_confirmation' ||
        drafted.phase === 'awaiting_reschedule_confirmation'
        ? ('review' as const)
        : ('reply' as const);
      const stored = await storeWorkflow(loaded.session.id, drafted, undefined, true);
      if (!stored) {
        const fresh = await loadOwned(actorUserId, sessionId);
        const stillChoosing =
          fresh.workflow.phase === loaded.workflow.phase &&
          !fresh.workflow.turnSettled &&
          slotStillOffered(fresh.workflow.offeredSlots, input.staffUserId, input.startsAt);
        if (!stillChoosing) {
          return replayTurn(actorUserId, fresh);
        }
        const retry = draftSlotSelection(fresh.workflow, slot, moving);
        const retried = await storeWorkflow(loaded.session.id, retry, undefined, false);
        if (!retried) {
          return replayTurn(actorUserId, await loadOwned(actorUserId, sessionId));
        }
        await appendAssistantMessage(fresh, reply);
        return present({
          ...fresh,
          workflow: retried,
          messages: await deps.repository.listMessages(loaded.session.id, MESSAGE_LIMIT),
          outcome:
            retry.phase === 'awaiting_confirmation' ||
            retry.phase === 'awaiting_reschedule_confirmation'
              ? 'review'
              : 'reply',
          appointment: null,
          suggestions: suggestionsFor(retried, []),
        });
      }
      await appendAssistantMessage(loaded, reply);
      return present({
        ...loaded,
        workflow: stored,
        messages: await deps.repository.listMessages(loaded.session.id, MESSAGE_LIMIT),
        outcome,
        appointment: null,
        suggestions: suggestionsFor(stored, []),
      });
    },

    async confirm(actorUserId, sessionId) {
      await loadOwned(actorUserId, sessionId);
      if (deps.beforeWorkflowSave) {
        await deps.beforeWorkflowSave();
      }
      const loaded = await loadOwned(actorUserId, sessionId);
      if (claimIsActive(loaded.workflow, now())) {
        return processingTurn(loaded);
      }
      if (loaded.workflow.phase === 'completed' && loaded.workflow.appointmentId) {
        const appointment = await deps.scheduling.getAppointment(
          actorUserId,
          loaded.workflow.appointmentId,
        );
        const outcome =
          appointment.status === 'cancelled'
            ? 'cancelled'
            : loaded.workflow.intent === 'reschedule'
              ? 'rescheduled'
              : 'booked';
        return present({ ...loaded, outcome, appointment, suggestions: [] });
      }

      try {
        if (
          loaded.workflow.phase === 'awaiting_confirmation' &&
          loaded.workflow.selectedSlot &&
          loaded.workflow.serviceId
        ) {
          const missing = contactMissing(loaded.workflow);
          if (missing.length > 0) {
            const workflow: WorkflowState = {
              ...loaded.workflow,
              phase: 'collecting',
              missingFields: missing,
              confirmationState: 'required',
            };
            const stored = await storeWorkflow(loaded.session.id, workflow, undefined, false);
            const current = stored ?? workflow;
            await appendAssistantMessage(loaded, askForContact(missing));
            return present({
              ...loaded,
              workflow: current,
              messages: await deps.repository.listMessages(loaded.session.id, MESSAGE_LIMIT),
              outcome: 'reply',
              appointment: null,
              suggestions: suggestionsFor(current, []),
            });
          }
          const created = await deps.scheduling.createAppointment({
            clinicId: loaded.clinic.id,
            timeZone: loaded.clinic.timezone,
            actorUserId,
            body: {
              serviceId: loaded.workflow.serviceId,
              staffUserId: loaded.workflow.selectedSlot.staffUserId,
              startsAt: loaded.workflow.selectedSlot.startsAt,
              patientContactName: loaded.workflow.contactName!,
              patientPhone: loaded.workflow.contactPhone!,
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
        const alreadyBooked = await matchingVisit(actorUserId, loaded);
        if (alreadyBooked && error instanceof AppError && error.code === 'SLOT_TAKEN') {
          return commit(loaded, alreadyBooked, 'booked', false);
        }
        const recovered = await recover(loaded, error);
        if (recovered) {
          return recovered;
        }
        throw error;
      }

      throw new ConfirmationRequiredError();
    },
  };

  async function respondFromIntent(
    actorUserId: string,
    loaded: Owned,
    catalog: Catalog,
    today: string,
    text: string,
    extracted: ModelIntent,
    interaction: Interaction,
  ) {
    const applied = applyExtraction(loaded.workflow, extracted);
    const withContact = absorbContactFromText(applied.state, text);
    const details = resolveBookingDetails({
      state: withContact,
      services: catalog.services,
      staff: catalog.staff,
      today,
    });
    let workflow: WorkflowState = {
      ...withContact,
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
        interaction,
      });
    }

    if (
      workflow.selectedSlot &&
      workflow.intent === 'book' &&
      !applied.preferenceChanged
    ) {
      const missing = contactMissing(workflow);
      if (missing.length > 0) {
        workflow = { ...workflow, phase: 'collecting', missingFields: missing };
        return finish(loaded, {
          workflow,
          reply: askForContact(missing),
          outcome: 'reply',
          interaction,
        });
      }
      const slot = workflow.selectedSlot;
      if (!slot) {
        return finish(loaded, {
          workflow,
          reply: askForContact(['name', 'phone']),
          outcome: 'reply',
          interaction,
        });
      }
      const label = await lookupServiceName(loaded.clinic.id, workflow.serviceId);
      workflow = {
        ...workflow,
        phase: 'awaiting_confirmation',
        missingFields: [],
        confirmationState: 'required',
      };
      return finish(loaded, {
        workflow,
        reply: describeReview({
          clinicName: loaded.clinic.name,
          serviceName: label,
          staffName: slot.staffName,
          startsAt: slot.startsAt,
          timeZone: loaded.clinic.timezone,
          moving: false,
          contactName: workflow.contactName,
          contactPhone: workflow.contactPhone,
        }),
        outcome: 'review',
        interaction,
      });
    }

    if (details.question) {
      workflow = { ...workflow, phase: 'collecting', offeredSlots: [], selectedSlot: null };
      return finish(loaded, {
        workflow,
        reply: details.question,
        outcome: 'reply',
        interaction,
      });
    }

    if (workflow.intent === 'list') {
      const visits = await upcoming(actorUserId, loaded.clinic.id);
      return finish(loaded, {
        workflow: { ...workflow, phase: 'collecting', confirmationState: 'not_required' },
        reply: describeVisits(visits, loaded.clinic.timezone),
        outcome: 'listed',
        interaction,
      });
    }

    if (workflow.intent === 'unsupported' || workflow.intent === 'clarify' || !workflow.intent) {
      return finish(loaded, {
        workflow: { ...workflow, phase: 'collecting' },
        reply: describeLimits(),
        outcome: 'reply',
        interaction,
      });
    }

    if (workflow.intent === 'cancel' || workflow.intent === 'reschedule') {
      const planned = await planChange(actorUserId, loaded.clinic, workflow);
      return finish(loaded, {
        workflow: planned.workflow,
        reply: planned.reply,
        outcome: planned.outcome,
        interaction,
      });
    }

    const searched = await search(loaded.clinic, workflow);
    return finish(loaded, {
      workflow: searched.workflow,
      reply: searched.reply,
      outcome: searched.outcome,
      interaction,
    });
  }

  function draftSlotSelection(
    workflow: WorkflowState,
    slot: NonNullable<WorkflowState['selectedSlot']>,
    moving: boolean,
  ): WorkflowState {
    const next: WorkflowState = {
      ...workflow,
      selectedSlot: slot,
      confirmationState: 'required',
    };
    if (moving) {
      return {
        ...next,
        phase: 'awaiting_reschedule_confirmation',
        missingFields: [],
      };
    }
    const missing = contactMissing(next);
    if (missing.length > 0) {
      return {
        ...next,
        phase: 'collecting',
        missingFields: missing,
      };
    }
    return {
      ...next,
      phase: 'awaiting_confirmation',
      missingFields: [],
    };
  }

  async function reviewOrContactReply(
    loaded: Owned,
    workflow: WorkflowState,
    serviceName: string,
    moving: boolean,
  ) {
    const missing = contactMissing(workflow);
    if (!moving && missing.length > 0) {
      return askForContact(missing);
    }
    const slot = workflow.selectedSlot;
    if (!slot) {
      return askForContact(['name', 'phone']);
    }
    return describeReview({
      clinicName: loaded.clinic.name,
      serviceName,
      staffName: slot.staffName,
      startsAt: slot.startsAt,
      timeZone: loaded.clinic.timezone,
      moving,
      contactName: workflow.contactName,
      contactPhone: workflow.contactPhone,
    });
  }

  async function claimTurn(
    actorUserId: string,
    base: Owned,
    text: string,
    options?: { retry?: boolean; turnKey?: string },
  ) {
    return deps.repository.withLockedSession(base.session.id, MESSAGE_LIMIT, async (locked) => {
      const loaded = ownedFrom(base, locked);
      const turnKey = options?.turnKey;
      if (claimIsActive(loaded.workflow, now()) && loaded.workflow.turnKey !== turnKey) {
        return { kind: 'busy' as const, loaded };
      }
      if (!turnKey) {
        const retrying = await failedTextRetry(loaded, text, options?.retry === true, locked);
        if (!retrying) {
          await locked.appendMessage({
            businessId: loaded.session.businessId,
            senderKind: 'user',
            senderUserId: actorUserId,
            body: text,
          });
        }
        return { kind: 'process' as const, loaded: ownedFrom(base, locked) };
      }

      const same = loaded.workflow.turnKey === turnKey;
      if (same && claimIsActive(loaded.workflow, now())) {
        return { kind: 'wait' as const, loaded };
      }
      const retryable =
        loaded.workflow.turnOutcome === 'unavailable' ||
        loaded.workflow.turnOutcome === 'invalid_output';
      if (same && loaded.workflow.turnSettled && !(options?.retry === true && retryable)) {
        return { kind: 'replay' as const, loaded };
      }
      if (!same) {
        await locked.appendMessage({
          businessId: loaded.session.businessId,
          senderKind: 'user',
          senderUserId: actorUserId,
          body: text,
        });
      }
      await locked.saveWorkflow({
        ...locked.workflow,
        turnKey,
        turnClaim: randomUUID(),
        turnClaimedAt: now().toISOString(),
        turnSettled: same ? locked.workflow.turnSettled : false,
        turnOutcome: same ? locked.workflow.turnOutcome : null,
      });
      return { kind: 'process' as const, loaded: ownedFrom(base, locked) };
    });
  }

  function ownedFrom(base: Owned, locked: LockedSession): Owned {
    return {
      session: locked.session,
      clinic: base.clinic,
      messages: [...locked.messages],
      workflow: locked.workflow,
    };
  }

  async function followTurn(actorUserId: string, loaded: Owned) {
    const sessionId = loaded.session.id;
    const turnKey = loaded.workflow.turnKey;
    const deadline = Date.now() + TURN_WAIT_MS;
    let signaled = false;
    while (Date.now() < deadline) {
      const subscription = subscribeTurn(sessionId);
      const current = await loadOwned(actorUserId, sessionId);
      const active = claimIsActive(current.workflow, now());
      if (current.workflow.turnKey === turnKey && current.workflow.turnSettled && !active) {
        subscription.cancel();
        return replayTurn(actorUserId, current);
      }
      if (!active) {
        subscription.cancel();
        return null;
      }
      if (!signaled) {
        signaled = true;
        deps.onTurnWait?.(sessionId);
      }
      await Promise.race([
        subscription.promise,
        new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, TURN_POLL_MS);
          void subscription.promise.then(() => clearTimeout(timeout));
        }),
      ]);
      subscription.cancel();
    }
    return null;
  }

  function processingTurn(loaded: Owned): AssistantTurn {
    return present({
      ...loaded,
      messages: [
        ...loaded.messages,
        {
          id: randomUUID(),
          senderKind: 'assistant',
          body: 'That message is still being handled. Nothing has been booked, cancelled, or rescheduled.',
          createdAt: now(),
        },
      ],
      outcome: 'unavailable',
      appointment: null,
      suggestions: [],
    });
  }

  function notifyTurn(sessionId: string) {
    const waiting = turnWaiters.get(sessionId) ?? [];
    turnWaiters.delete(sessionId);
    for (const resolve of waiting) {
      resolve();
    }
  }

  function subscribeTurn(sessionId: string) {
    let resolveWait = () => {};
    const promise = new Promise<void>((resolve) => {
      resolveWait = resolve;
    });
    const waiting = turnWaiters.get(sessionId) ?? [];
    waiting.push(resolveWait);
    turnWaiters.set(sessionId, waiting);
    return {
      promise,
      cancel() {
        const remaining = (turnWaiters.get(sessionId) ?? []).filter(
          (resolve) => resolve !== resolveWait,
        );
        if (remaining.length === 0) {
          turnWaiters.delete(sessionId);
        } else {
          turnWaiters.set(sessionId, remaining);
        }
      },
    };
  }

  function claimIsActive(workflow: WorkflowState, at: Date) {
    if (!workflow.turnClaim || !workflow.turnClaimedAt) {
      return false;
    }
    const started = Date.parse(workflow.turnClaimedAt);
    if (Number.isNaN(started)) {
      return false;
    }
    return at.getTime() - started < TURN_CLAIM_TTL_MS;
  }

  async function failedTextRetry(
    loaded: Owned,
    text: string,
    retry: boolean,
    locked: LockedSession,
  ) {
    if (!retry) {
      return false;
    }
    const last = loaded.messages.at(-1);
    const previous = loaded.messages.at(-2);
    if (
      last?.senderKind !== 'assistant' ||
      previous?.senderKind !== 'user' ||
      previous.body !== text
    ) {
      return false;
    }
    const interaction = await locked.latestInteraction();
    return interaction?.status === 'failed';
  }

  async function replayTurn(actorUserId: string, loaded: Owned) {
    const appointment = await linkedAppointment(actorUserId, loaded.workflow);
    const names = (await catalogFor(loaded.clinic)).services.map((service) => service.name);
    return present({
      ...loaded,
      outcome: loaded.workflow.turnOutcome ?? 'loaded',
      appointment:
        loaded.workflow.turnOutcome === 'booked' ||
        loaded.workflow.turnOutcome === 'cancelled' ||
        loaded.workflow.turnOutcome === 'rescheduled'
          ? appointment
          : null,
      suggestions: suggestionsFor(loaded.workflow, names),
    });
  }

  async function matchingVisit(actorUserId: string, loaded: Owned) {
    const slot = loaded.workflow.selectedSlot;
    if (!slot || !loaded.workflow.serviceId) {
      return null;
    }
    const mine = await deps.scheduling.listMine(actorUserId);
    return (
      mine.find(
        (visit) =>
          visit.clinicId === loaded.clinic.id &&
          visit.serviceId === loaded.workflow.serviceId &&
          visit.staffUserId === slot.staffUserId &&
          visit.startsAt === slot.startsAt &&
          (visit.status === 'confirmed' || visit.status === 'requested'),
      ) ?? null
    );
  }

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
    const stored = await storeWorkflow(loaded.session.id, workflow, appointment.id, true);
    if (!stored) {
      const fresh = await loadOwned(loaded.session.participantUserId, loaded.session.id);
      if (fresh.workflow.phase === 'completed' && fresh.workflow.appointmentId === appointment.id) {
        return present({
          ...fresh,
          session: { ...fresh.session, appointmentId: appointment.id },
          outcome,
          appointment,
          suggestions: [],
        });
      }
      const merged = await deps.repository.completeConfirmedWorkflow(
        loaded.session.id,
        appointment.id,
      );
      if (merged === 'other') {
        return replayTurn(
          loaded.session.participantUserId,
          await loadOwned(loaded.session.participantUserId, loaded.session.id),
        );
      }
      const current = await loadOwned(loaded.session.participantUserId, loaded.session.id);
      if (merged === 'stored') {
        await appendAssistantMessage(current, reply);
      }
      return present({
        ...current,
        session: { ...current.session, appointmentId: appointment.id },
        workflow: current.workflow,
        messages: await deps.repository.listMessages(loaded.session.id, MESSAGE_LIMIT),
        outcome,
        appointment,
        suggestions: [],
      });
    }
    await appendAssistantMessage(loaded, reply);
    return present({
      ...loaded,
      session: { ...loaded.session, appointmentId: appointment.id },
      workflow: stored,
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
    const stored = await storeWorkflow(loaded.session.id, next, undefined, false);
    await appendAssistantMessage(loaded, reply);
    const current =
      stored ?? (await loadOwned(loaded.session.participantUserId, loaded.session.id)).workflow;
    return present({
      ...loaded,
      workflow: current,
      messages: await deps.repository.listMessages(loaded.session.id, MESSAGE_LIMIT),
      outcome: 'slots',
      appointment: null,
      suggestions: [],
    });
  }

  async function storeWorkflow(
    sessionId: string,
    state: WorkflowState,
    appointmentId: string | null | undefined,
    pause: boolean,
  ) {
    if (pause && deps.beforeWorkflowSave) {
      await deps.beforeWorkflowSave();
    }
    const result = await deps.repository.saveWorkflow(sessionId, state, appointmentId);
    if (result === 'stale') {
      return null;
    }
    return { ...state, revision: state.revision + 1 };
  }

  async function appendAssistantMessage(loaded: Owned, body: string) {
    await deps.repository.appendMessage({
      businessId: loaded.session.businessId,
      sessionId: loaded.session.id,
      senderKind: 'assistant',
      senderUserId: null,
      body,
    });
  }

  async function answerTurn(actorUserId: string, loaded: Owned, text: string) {
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
    const today = clinicDate(now(), loaded.clinic.timezone);
    if (
      loaded.workflow.selectedSlot &&
      loaded.workflow.intent === 'book' &&
      contactMissing(loaded.workflow).length > 0
    ) {
      const absorbed = absorbContactFromText(loaded.workflow, text);
      if (
        absorbed.contactName !== loaded.workflow.contactName ||
        absorbed.contactPhone !== loaded.workflow.contactPhone
      ) {
        return respondFromIntent(
          actorUserId,
          loaded,
          catalog,
          today,
          text,
          {
            intent: 'book',
            serviceQuery: null,
            datePreference: null,
            timePreference: null,
            staffQuery: null,
            contactName: absorbed.contactName,
            contactPhone: absorbed.contactPhone,
            missingFields: contactMissing(absorbed),
            needsClarification: contactMissing(absorbed).length > 0,
            clarificationQuestion: null,
            proposedAction: 'ask',
            confirmationState: 'required',
            emergency: false,
            topic: null,
          },
          {
            purpose: 'grounded_contact',
            model: 'careflow-catalog',
            promptTokens: 0,
            completionTokens: 0,
            latencyMs: 0,
            status: 'succeeded',
            errorCode: null,
          },
        );
      }
    }
    const grounded = groundMessage({
      text,
      workflow: loaded.workflow,
      services: catalog.services,
      staff: catalog.staff,
      today,
    });
    if (grounded) {
      return respondFromIntent(actorUserId, loaded, catalog, today, text, grounded, {
        purpose: 'grounded_detail',
        model: 'careflow-catalog',
        promptTokens: 0,
        completionTokens: 0,
        latencyMs: 0,
        status: 'succeeded',
        errorCode: null,
      });
    }

    let completion: Awaited<ReturnType<ModelClient['complete']>>;
    try {
      const history = await deps.repository.listMessages(loaded.session.id, MESSAGE_LIMIT);
      completion = await deps.model.complete({
        system: buildSystemPrompt({
          serviceNames: catalog.services.map((service) => service.name),
          staffNames: catalog.staff.map((person) => person.displayName),
          today,
          timeZone: loaded.clinic.timezone,
          state: loaded.workflow,
        }),
        messages: history
          .filter((message) => message.senderKind === 'user' || message.senderKind === 'assistant')
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
        providerStatus: failure.providerStatus,
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
    if (isClinicQuestion(parsed.intent)) {
      return finish(loaded, {
        workflow: loaded.workflow,
        reply: clinicReply(parsed.intent.topic, catalog.services),
        outcome: 'reply',
        interaction: metric(completion, 'succeeded', null),
      });
    }
    if (isBareUnsupported(parsed.intent)) {
      return finish(loaded, {
        workflow: loaded.workflow,
        reply: describeLimits(),
        outcome: 'reply',
        interaction: metric(completion, 'succeeded', null),
      });
    }

    return respondFromIntent(
      actorUserId,
      loaded,
      catalog,
      today,
      text,
      parsed.intent,
      metric(completion, 'succeeded', null),
    );
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
    const claimId = input.workflow.turnClaim;
    if (input.workflow.turnKey !== null && claimId) {
      if (deps.beforeTurnPersist) {
        await deps.beforeTurnPersist();
      }
      const workflow: WorkflowState = {
        ...input.workflow,
        turnClaim: null,
        turnClaimedAt: null,
        turnSettled: true,
        turnOutcome: input.outcome,
      };
      const result = await deps.repository.commitClaimedTurn({
        sessionId: loaded.session.id,
        claimId,
        workflow,
        outcome: input.outcome,
        businessId: loaded.session.businessId,
        actorUserId: loaded.session.participantUserId,
        reply: input.reply,
        interaction: input.interaction,
      });
      notifyTurn(loaded.session.id);
      if (result === 'lost') {
        return replayTurn(
          loaded.session.participantUserId,
          await loadOwned(loaded.session.participantUserId, loaded.session.id),
        );
      }
      const current = await loadOwned(loaded.session.participantUserId, loaded.session.id);
      const names = (await catalogFor(loaded.clinic)).services.map((service) => service.name);
      return present({
        ...current,
        messages: await deps.repository.listMessages(loaded.session.id, MESSAGE_LIMIT),
        outcome: input.outcome,
        appointment: await linkedAppointment(loaded.session.participantUserId, current.workflow),
        suggestions: suggestionsFor(current.workflow, names),
      });
    }

    const workflow: WorkflowState = {
      ...input.workflow,
      turnKey: loaded.workflow.turnKey,
      turnClaim: null,
      turnClaimedAt: null,
      turnSettled: loaded.workflow.turnSettled,
      turnOutcome: loaded.workflow.turnOutcome,
    };
    const stored = await storeWorkflow(loaded.session.id, workflow, undefined, false);
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
    const current =
      stored ?? (await loadOwned(loaded.session.participantUserId, loaded.session.id)).workflow;
    return present({
      ...loaded,
      workflow: current,
      messages: await deps.repository.listMessages(loaded.session.id, MESSAGE_LIMIT),
      outcome: input.outcome,
      appointment: null,
      suggestions: suggestionsFor(current, names),
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

type Catalog = {
  services: Array<{ id: string; name: string; durationMinutes: number; active: boolean }>;
  staff: Array<{ userId: string; displayName: string }>;
};

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
    null,
  );
}

function hasSchedulingDetail(intent: ModelIntent) {
  return Boolean(
    intent.serviceQuery || intent.datePreference || intent.timePreference || intent.staffQuery,
  );
}

function isClinicQuestion(intent: ModelIntent) {
  return (
    intent.topic !== null &&
    !hasSchedulingDetail(intent) &&
    (intent.intent === 'clarify' || intent.intent === 'unsupported')
  );
}

function isBareUnsupported(intent: ModelIntent) {
  return intent.intent === 'unsupported' && intent.topic === null && !hasSchedulingDetail(intent);
}

function clinicReply(topic: ModelIntent['topic'], services: Catalog['services']) {
  if (topic === 'services') {
    return describeServices(services);
  }
  if (topic === 'schedule') {
    return describeSchedule();
  }
  if (topic === 'policy') {
    return describePolicy();
  }
  return describeLimits();
}

function assistantKey(sessionId: string, startsAt: string) {
  const compact = sessionId.replace(/-/g, '');
  const stamp = String(new Date(startsAt).getTime());
  return `asst${compact}${stamp}`.slice(0, 80);
}
