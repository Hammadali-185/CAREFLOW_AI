import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useToast } from '../../components/feedback/toast-context';
import { useApiClient } from '../../hooks/use-api';
import { ApiError } from '../../lib/api-client';
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-session';

export function AuthProvider({ children }: { children: ReactNode }) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const session = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: ({ signal }) => api.currentUser(signal),
    retry: false,
  });

  useEffect(() => {
    setCsrfToken(session.data?.csrfToken ?? null);
  }, [session.data]);

  useEffect(() => {
    api.setUnauthorizedHandler(() => {
      setCsrfToken(null);
      queryClient.setQueryData(['auth', 'me'], null);
      toast.show('Your session expired. Sign in again.', 'warning');
    });
  }, [api, queryClient, toast]);

  const value = useMemo<AuthContextValue>(() => {
    const status: AuthStatus = session.isPending
      ? 'loading'
      : session.isError
        ? 'error'
        : session.data
          ? 'authenticated'
          : 'anonymous';

    return {
      status,
      user: session.data?.user ?? null,
      csrfToken,
      async login(input) {
        const next = await api.login(input);
        setCsrfToken(next.csrfToken);
        queryClient.setQueryData(['auth', 'me'], next);
      },
      async signup(input) {
        const next = await api.signup(input);
        setCsrfToken(next.csrfToken);
        queryClient.setQueryData(['auth', 'me'], next);
      },
      async logout() {
        if (!csrfToken) {
          throw new ApiError('Sign in to continue.', 401, 'UNAUTHENTICATED');
        }
        await api.logout(csrfToken);
        setCsrfToken(null);
        queryClient.setQueryData(['auth', 'me'], null);
      },
      async refresh() {
        await session.refetch();
      },
    };
  }, [api, csrfToken, queryClient, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
