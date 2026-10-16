import type { WorkflowState } from '@careflow/shared';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { NotFoundError } from '../errors/app-error.js';
import { emptyWorkflow, readWorkflow } from '../modules/assistant/workflow.js';

export type StoredSession = {
  id: string;
  businessId: string;
  participantUserId: string;
  appointmentId: string | null;
  openedAt: Date;
  workflowState: unknown;
};

export type StoredMessage = {
  id: string;
  senderKind: 'user' | 'assistant' | 'system';
  body: string;
  createdAt: Date;
};

export type AssistantRepository = {
  createSession(input: { businessId: string; participantUserId: string }): Promise<StoredSession>;
  listSessions(input: { businessId: string; participantUserId: string }): Promise<
    Array<{
      id: string;
      businessId: string;
      openedAt: Date;
      appointmentId: string | null;
      preview: string | null;
    }>
  >;
  findSession(sessionId: string): Promise<StoredSession | null>;
  listMessages(sessionId: string, limit: number): Promise<StoredMessage[]>;
  appendMessage(input: {
    businessId: string;
    sessionId: string;
    senderKind: 'user' | 'assistant' | 'system';
    senderUserId: string | null;
    body: string;
  }): Promise<StoredMessage>;
  saveWorkflow(
    sessionId: string,
    state: WorkflowState,
    appointmentId?: string | null,
  ): Promise<'stored' | 'stale'>;
  recordInteraction(input: {
    businessId: string;
    actorUserId: string;
    chatSessionId: string;
    purpose: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
    status: 'succeeded' | 'failed' | 'refused';
    errorCode: string | null;
  }): Promise<void>;
  latestInteraction(
    sessionId: string,
  ): Promise<{ status: 'succeeded' | 'failed' | 'refused'; errorCode: string | null } | null>;
  withLockedSession<T>(
    sessionId: string,
    messageLimit: number,
    run: (locked: LockedSession) => Promise<T>,
  ): Promise<T>;
  commitClaimedTurn(input: ClaimedTurnCommit): Promise<'stored' | 'lost'>;
  completeConfirmedWorkflow(
    sessionId: string,
    appointmentId: string,
  ): Promise<'stored' | 'same' | 'other'>;
};

export type LockedSession = {
  session: StoredSession;
  messages: StoredMessage[];
  workflow: WorkflowState;
  appendMessage(input: {
    businessId: string;
    senderKind: 'user' | 'assistant' | 'system';
    senderUserId: string | null;
    body: string;
  }): Promise<StoredMessage>;
  saveWorkflow(state: WorkflowState): Promise<void>;
  latestInteraction(): Promise<{
    status: 'succeeded' | 'failed' | 'refused';
    errorCode: string | null;
  } | null>;
};

export type ClaimedTurnCommit = {
  sessionId: string;
  claimId: string;
  workflow: WorkflowState;
  outcome: WorkflowState['turnOutcome'];
  businessId: string;
  actorUserId: string;
  reply: string;
  interaction: {
    purpose: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
    status: 'succeeded' | 'failed' | 'refused';
    errorCode: string | null;
  };
};

export function createPrismaAssistantRepository(prisma: PrismaClient): AssistantRepository {
  return {
    async createSession(input) {
      const row = await prisma.chatSession.create({
        data: {
          businessId: input.businessId,
          participantUserId: input.participantUserId,
          workflowState: emptyWorkflow() as Prisma.InputJsonValue,
        },
        select: sessionSelect,
      });
      return row;
    },

    async listSessions(input) {
      const sessions = await prisma.chatSession.findMany({
        where: { businessId: input.businessId, participantUserId: input.participantUserId },
        orderBy: { openedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          businessId: true,
          openedAt: true,
          appointmentId: true,
        },
      });
      if (sessions.length === 0) {
        return [];
      }
      const messages = await prisma.chatMessage.findMany({
        where: { sessionId: { in: sessions.map((session) => session.id) } },
        orderBy: { createdAt: 'desc' },
        select: { sessionId: true, body: true },
      });
      const preview = new Map<string, string>();
      for (const message of messages) {
        if (!preview.has(message.sessionId)) {
          preview.set(message.sessionId, message.body.slice(0, 80));
        }
      }
      return sessions.map((session) => ({
        ...session,
        preview: preview.get(session.id) ?? null,
      }));
    },

    async findSession(sessionId) {
      return prisma.chatSession.findUnique({
        where: { id: sessionId },
        select: sessionSelect,
      });
    },

    async listMessages(sessionId, limit) {
      const rows = await prisma.chatMessage.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          senderKind: true,
          body: true,
          createdAt: true,
        },
      });
      return rows.reverse();
    },

    async appendMessage(input) {
      return prisma.chatMessage.create({
        data: {
          businessId: input.businessId,
          sessionId: input.sessionId,
          senderKind: input.senderKind,
          senderUserId: input.senderUserId,
          body: input.body,
        },
        select: {
          id: true,
          senderKind: true,
          body: true,
          createdAt: true,
        },
      });
    },

    async saveWorkflow(sessionId, state, appointmentId) {
      return prisma.$transaction(async (tx) => {
        await lockSession(tx, sessionId);
        const session = await tx.chatSession.findUnique({
          where: { id: sessionId },
          select: { workflowState: true },
        });
        if (!session) {
          throw new NotFoundError('That conversation was not found.');
        }
        const current = readWorkflow(session.workflowState);
        if (current.revision !== state.revision) {
          return 'stale' as const;
        }
        const next: WorkflowState = { ...state, revision: current.revision + 1 };
        await tx.chatSession.update({
          where: { id: sessionId },
          data: {
            workflowState: next as Prisma.InputJsonValue,
            ...(appointmentId !== undefined ? { appointmentId } : {}),
          },
        });
        return 'stored' as const;
      });
    },

    async recordInteraction(input) {
      await prisma.aiInteraction.create({
        data: {
          businessId: input.businessId,
          actorUserId: input.actorUserId,
          chatSessionId: input.chatSessionId,
          purpose: input.purpose,
          model: input.model,
          promptTokens: input.promptTokens,
          completionTokens: input.completionTokens,
          latencyMs: input.latencyMs,
          status: input.status,
          errorCode: input.errorCode,
        },
      });
    },

    async latestInteraction(sessionId) {
      const row = await prisma.aiInteraction.findFirst({
        where: { chatSessionId: sessionId },
        orderBy: { createdAt: 'desc' },
        select: { status: true, errorCode: true },
      });
      return row;
    },

    async withLockedSession(sessionId, messageLimit, run) {
      return prisma.$transaction(async (tx) => {
        await lockSession(tx, sessionId);
        const session = await tx.chatSession.findUnique({
          where: { id: sessionId },
          select: sessionSelect,
        });
        if (!session) {
          throw new NotFoundError('That conversation was not found.');
        }
        const messages = await listMessages(tx, sessionId, messageLimit);
        let workflow = readWorkflow(session.workflowState);
        const locked: LockedSession = {
          session,
          messages,
          get workflow() {
            return workflow;
          },
          async appendMessage(input) {
            const message = await tx.chatMessage.create({
              data: {
                businessId: input.businessId,
                sessionId,
                senderKind: input.senderKind,
                senderUserId: input.senderUserId,
                body: input.body,
              },
              select: messageSelect,
            });
            messages.push(message);
            return message;
          },
          async saveWorkflow(state) {
            const next: WorkflowState = { ...state, revision: workflow.revision + 1 };
            workflow = next;
            await tx.chatSession.update({
              where: { id: sessionId },
              data: { workflowState: next as Prisma.InputJsonValue },
            });
          },
          async latestInteraction() {
            return tx.aiInteraction.findFirst({
              where: { chatSessionId: sessionId },
              orderBy: { createdAt: 'desc' },
              select: { status: true, errorCode: true },
            });
          },
        };
        return run(locked);
      });
    },

    async commitClaimedTurn(input) {
      return prisma.$transaction(async (tx) => {
        await lockSession(tx, input.sessionId);
        const session = await tx.chatSession.findUnique({
          where: { id: input.sessionId },
          select: { workflowState: true },
        });
        const stored = session ? readWorkflow(session.workflowState) : null;
        if (!stored || stored.turnClaim !== input.claimId) {
          return 'lost' as const;
        }
        await tx.chatMessage.create({
          data: {
            businessId: input.businessId,
            sessionId: input.sessionId,
            senderKind: 'assistant',
            senderUserId: null,
            body: input.reply,
          },
        });
        await tx.aiInteraction.create({
          data: {
            businessId: input.businessId,
            actorUserId: input.actorUserId,
            chatSessionId: input.sessionId,
            purpose: input.interaction.purpose,
            model: input.interaction.model,
            promptTokens: input.interaction.promptTokens,
            completionTokens: input.interaction.completionTokens,
            latencyMs: input.interaction.latencyMs,
            status: input.interaction.status,
            errorCode: input.interaction.errorCode,
          },
        });
        const base = stored.revision === input.workflow.revision ? input.workflow : stored;
        const workflow: WorkflowState = {
          ...base,
          turnKey: input.workflow.turnKey,
          turnClaim: null,
          turnClaimedAt: null,
          turnSettled: true,
          turnOutcome: input.outcome,
          revision: stored.revision + 1,
        };
        await tx.chatSession.update({
          where: { id: input.sessionId },
          data: { workflowState: workflow as Prisma.InputJsonValue },
        });
        return 'stored' as const;
      });
    },

    async completeConfirmedWorkflow(sessionId, appointmentId) {
      return prisma.$transaction(async (tx) => {
        await lockSession(tx, sessionId);
        const session = await tx.chatSession.findUnique({
          where: { id: sessionId },
          select: { workflowState: true },
        });
        if (!session) {
          throw new NotFoundError('That conversation was not found.');
        }
        const current = readWorkflow(session.workflowState);
        if (current.phase === 'completed' && current.appointmentId === appointmentId) {
          return 'same' as const;
        }
        if (
          current.phase === 'completed' &&
          current.appointmentId &&
          current.appointmentId !== appointmentId
        ) {
          return 'other' as const;
        }
        const next: WorkflowState = {
          ...current,
          phase: 'completed',
          appointmentId,
          confirmationState: 'not_required',
          selectedSlot: null,
          offeredSlots: [],
          revision: current.revision + 1,
        };
        await tx.chatSession.update({
          where: { id: sessionId },
          data: {
            workflowState: next as Prisma.InputJsonValue,
            appointmentId,
          },
        });
        return 'stored' as const;
      });
    },
  };
}

const messageSelect = {
  id: true,
  senderKind: true,
  body: true,
  createdAt: true,
} as const;

function lockSession(tx: Prisma.TransactionClient, sessionId: string) {
  return tx.$queryRaw`SELECT "id" FROM "chat_sessions" WHERE "id" = CAST(${sessionId} AS uuid) FOR UPDATE`;
}

async function listMessages(
  prisma: Prisma.TransactionClient | PrismaClient,
  sessionId: string,
  limit: number,
) {
  const rows = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: messageSelect,
  });
  return rows.reverse();
}

const sessionSelect = {
  id: true,
  businessId: true,
  participantUserId: true,
  appointmentId: true,
  openedAt: true,
  workflowState: true,
} as const;
