import type { LoginRequest, MembershipRole, PublicUser, SignupRequest } from '@careflow/shared';
import { absorbMissingAccount, hashPassword, verifyPassword } from '../modules/auth/password.js';
import {
  csrfTokenFor,
  createSessionToken,
  hashSessionToken,
  SESSION_TTL_MS,
} from '../modules/auth/tokens.js';
import {
  AccountExistsError,
  AuthenticationFailedError,
  UnknownClinicError,
} from '../errors/http-errors.js';
import {
  DuplicateEmailError,
  UnknownBusinessError,
  type AuthRepository,
} from '../repositories/auth.repository.js';

export type IssuedSession = {
  token: string;
  csrfToken: string;
  user: PublicUser;
};

export type AuthenticatedSession = {
  sessionId: string;
  sessionToken: string;
  user: PublicUser;
};

export type AuthService = {
  signup(input: SignupRequest, existingToken: string | undefined): Promise<IssuedSession>;
  login(input: LoginRequest, existingToken: string | undefined): Promise<IssuedSession>;
  logout(sessionToken: string): Promise<void>;
  authenticate(sessionToken: string): Promise<AuthenticatedSession | null>;
  csrfTokenForSession(sessionToken: string): string;
  clinicAccess(
    userId: string,
    clinicId: string,
    allowed: readonly MembershipRole[],
  ): Promise<{
    clinic: { id: string; name: string; slug: string; timezone: string };
    role: MembershipRole;
  } | null>;
};

export function createAuthService(deps: {
  repository: AuthRepository;
  csrfSecret: string;
  now?: () => Date;
}): AuthService {
  const now = deps.now ?? (() => new Date());

  return {
    async signup(input, existingToken) {
      const passwordHash = await hashPassword(input.password);
      let user: PublicUser;
      try {
        user = await deps.repository.createPatient({
          email: input.email,
          passwordHash,
          displayName: input.displayName,
          businessSlug: input.businessSlug,
        });
      } catch (error) {
        if (error instanceof UnknownBusinessError) {
          throw new UnknownClinicError();
        }
        if (error instanceof DuplicateEmailError) {
          throw new AccountExistsError();
        }
        throw error;
      }

      return issueSession(deps, user, existingToken, now());
    },

    async login(input, existingToken) {
      const credential = await deps.repository.findCredentialByEmail(input.email);
      if (!credential) {
        await absorbMissingAccount(input.password);
        throw new AuthenticationFailedError();
      }

      const matches = await verifyPassword(input.password, credential.passwordHash);
      if (!matches) {
        throw new AuthenticationFailedError();
      }

      const user = await deps.repository.findPublicUserById(credential.id);
      if (!user) {
        throw new AuthenticationFailedError();
      }

      return issueSession(deps, user, existingToken, now());
    },

    async logout(sessionToken) {
      await deps.repository.revokeSession(hashSessionToken(sessionToken), now());
    },

    async authenticate(sessionToken) {
      const active = await deps.repository.findActiveSession(hashSessionToken(sessionToken), now());
      if (!active) {
        return null;
      }
      return {
        sessionId: active.sessionId,
        sessionToken,
        user: active.user,
      };
    },

    csrfTokenForSession(sessionToken) {
      return csrfTokenFor(sessionToken, deps.csrfSecret);
    },

    clinicAccess(userId, clinicId, allowed) {
      return deps.repository.findClinicAccess(userId, clinicId).then((access) => {
        if (!access || !allowed.includes(access.role)) {
          return null;
        }
        return access;
      });
    },
  };
}

async function issueSession(
  deps: { repository: AuthRepository; csrfSecret: string },
  user: PublicUser,
  existingToken: string | undefined,
  issuedAt: Date,
): Promise<IssuedSession> {
  if (existingToken) {
    await deps.repository.revokeSession(hashSessionToken(existingToken), issuedAt);
  }

  const token = createSessionToken();
  await deps.repository.createSession({
    userId: user.id,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(issuedAt.getTime() + SESSION_TTL_MS),
    createdAt: issuedAt,
  });

  return {
    token,
    csrfToken: csrfTokenFor(token, deps.csrfSecret),
    user,
  };
}
