import type { SchedulingService } from '../src/services/scheduling.service.js';

export const unusedScheduling = new Proxy({} as SchedulingService, {
  get() {
    return () => Promise.reject(new Error('Scheduling is not used by this test.'));
  },
});
