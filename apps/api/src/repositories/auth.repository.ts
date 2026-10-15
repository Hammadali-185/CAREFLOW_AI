import type { MembershipRole, PublicUser } from '@careflow/shared';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';

const publicUserSelect = {
  id: true,
  email: true,
  displayName: true,
  memberships: {
    orderBy: { createdAt: 'asc' },
    select: {
      businessId: true,
      role: true,
      business: {
        select: {
          name: true,
          slug: true,
        },
      },
    },
  },
} satisfies Prisma.UserSelect;

type PublicUserRecord = Prisma.UserGetPayload<{ select: typeof publicUserSelect }>;

export type AuthRepository = {
  findCredentialByEmail(email: string): Promise<{ id: string; passwordHash: string } | null>;
  findPublicUserById(id: string): Promise<PublicUser | null>;
  createPatient(input: {
    email: string;
    passwordHash: string;
    displayName: string;
    businessSlug: string;
  }): Promise<PublicUser>;
  createSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
  }): Promise<string>;
  findActiveSession(
    tokenHash: string,
    now: Date,
  ): Promise<{ sessionId: string; user: PublicUser } | null>;
  revokeSession(tokenHash: string, revokedAt: Date): Promise<void>;
  findClinicAccess(
    userId: string,
    clinicId: string,
  ): Promise<{
    clinic: { id: string; name: string; slug: string; timezone: string };
    role: MembershipRole;
  } | null>;
};

export function createPrismaAuthRepository(prisma: PrismaClient): AuthRepository {
  return {
    async findCredentialByEmail(email) {
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, passwordHash: true },
      });
      return user;
    },

    async findPublicUserById(id) {
      const user = await prisma.user.findUnique({ where: { id }, select: publicUserSelect });
      return user ? toPublicUser(user) : null;
    },

    async createPatient(input) {
      const business = await prisma.business.findUnique({
        where: { slug: input.businessSlug },
        select: { id: true },
      });
      if (!business) {
        throw new UnknownBusinessError();
      }

      try {
        const user = await prisma.user.create({
          data: {
            email: input.email,
            passwordHash: input.passwordHash,
            displayName: input.displayName,
            memberships: {
              create: {
                businessId: business.id,
                role: 'patient',
              },
            },
          },
          select: publicUserSelect,
        });
        return toPublicUser(user);
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new DuplicateEmailError();
        }
        throw error;
      }
    },

    async createSession(input) {
      const session = await prisma.authSession.create({
        data: input,
        select: { id: true },
      });
      return session.id;
    },

    async findActiveSession(tokenHash, now) {
      const session = await prisma.authSession.findFirst({
        where: {
          tokenHash,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        select: {
          id: true,
          user: { select: publicUserSelect },
        },
      });
      if (!session) {
        return null;
      }
      return { sessionId: session.id, user: toPublicUser(session.user) };
    },

    async revokeSession(tokenHash, revokedAt) {
      await prisma.authSession.updateMany({
        where: { tokenHash, revokedAt: null },
        data: { revokedAt },
      });
    },

    async findClinicAccess(userId, clinicId) {
      const membership = await prisma.businessMembership.findUnique({
        where: { businessId_userId: { businessId: clinicId, userId } },
        select: {
          role: true,
          business: {
            select: { id: true, name: true, slug: true, timezone: true },
          },
        },
      });
      if (!membership) {
        return null;
      }
      return {
        clinic: membership.business,
        role: membership.role,
      };
    },
  };
}

export class UnknownBusinessError extends Error {
  constructor() {
    super('Unknown business');
    this.name = 'UnknownBusinessError';
  }
}

export class DuplicateEmailError extends Error {
  constructor() {
    super('Duplicate email');
    this.name = 'DuplicateEmailError';
  }
}

function toPublicUser(user: PublicUserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    memberships: user.memberships.map((membership) => ({
      businessId: membership.businessId,
      businessName: membership.business.name,
      businessSlug: membership.business.slug,
      role: membership.role as MembershipRole,
    })),
  };
}
