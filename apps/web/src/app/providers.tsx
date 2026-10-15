import { QueryClientProvider } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { ToastProvider } from '../components/feedback/Toast';
import { AuthProvider } from '../features/auth/auth-context';
import { ApiContext } from '../lib/api-context';
import { createApiClient } from '../lib/api-client';
import type { WebConfig } from '../lib/config';
import { createQueryClient } from '../lib/query-client';

export function AppProviders({ config, children }: { config: WebConfig; children: ReactNode }) {
  const [queryClient] = useState(() => createQueryClient());
  const apiClient = useMemo(() => createApiClient(config.apiBaseUrl), [config.apiBaseUrl]);

  return (
    <ApiContext.Provider value={apiClient}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </ApiContext.Provider>
  );
}
