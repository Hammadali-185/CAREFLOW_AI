import { useContext } from 'react';
import { ApiContext } from '../lib/api-context';

export function useApiClient() {
  const client = useContext(ApiContext);
  if (!client) {
    throw new Error('useApiClient must be used within AppProviders.');
  }

  return client;
}
