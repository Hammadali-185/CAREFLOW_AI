import { createContext } from 'react';
import type { ApiClient } from './api-client';

export const ApiContext = createContext<ApiClient | null>(null);
