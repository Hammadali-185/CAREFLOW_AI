import { API_SERVICE_NAME, type HealthResponse, type ReadinessResponse } from '@careflow/shared';
import type { DatabaseProbe } from '../repositories/database-probe.js';

export function createHealthService(probe: DatabaseProbe) {
  return {
    liveness(): HealthResponse {
      return {
        status: 'ok',
        service: API_SERVICE_NAME,
        timestamp: new Date().toISOString(),
      };
    },
    async readiness(): Promise<ReadinessResponse> {
      try {
        await probe.ping();
        return {
          status: 'ok',
          database: 'up',
          timestamp: new Date().toISOString(),
        };
      } catch {
        return {
          status: 'unavailable',
          database: 'down',
          timestamp: new Date().toISOString(),
        };
      }
    },
  };
}

export type HealthService = ReturnType<typeof createHealthService>;
