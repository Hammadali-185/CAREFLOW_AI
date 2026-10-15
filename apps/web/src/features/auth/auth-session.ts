import type { LoginRequest, PublicUser, SignupRequest } from '@careflow/shared';
import { createContext, useContext } from 'react';

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated' | 'error';

export type AuthContextValue = {
  status: AuthStatus;
  user: PublicUser | null;
  csrfToken: string | null;
  login: (input: LoginRequest) => Promise<void>;
  signup: (input: SignupRequest) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const auth = useContext(AuthContext);
  if (!auth) {
    throw new Error('useAuth must be used within AuthProvider.');
  }
  return auth;
}
