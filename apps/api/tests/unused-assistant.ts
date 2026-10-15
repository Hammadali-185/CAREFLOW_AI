import type { AssistantService } from '../src/services/assistant.service.js';

export const unusedAssistant = new Proxy({} as AssistantService, {
  get() {
    return () => Promise.reject(new Error('The assistant is not used by this test.'));
  },
});
