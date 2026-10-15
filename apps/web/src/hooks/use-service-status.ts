import { useQuery } from '@tanstack/react-query';
import { useApiClient } from './use-api';

export function useHealthQuery() {
  const api = useApiClient();

  return useQuery({
    queryKey: ['health', api.baseUrl],
    queryFn: ({ signal }) => api.health(signal),
  });
}

export function useReadinessQuery() {
  const api = useApiClient();

  return useQuery({
    queryKey: ['health', 'ready', api.baseUrl],
    queryFn: ({ signal }) => api.readiness(signal),
  });
}
