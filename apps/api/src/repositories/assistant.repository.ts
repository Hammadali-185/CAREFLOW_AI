import type { WorkflowState } from '@careflow/shared';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { emptyWorkflow } from '../modules/assistant/workflow.js';

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
  ): Promise<void>;
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
      await prisma.chatSession.update({
        where: { id: sessionId },
        data: {
          workflowState: state as Prisma.InputJsonValue,
          ...(appointmentId !== undefined ? { appointmentId } : {}),
        },
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
  };
}

const sessionSelect = {
  id: true,
  businessId: true,
  participantUserId: true,
  appointmentId: true,
  openedAt: true,
  workflowState: true,
} as const;
