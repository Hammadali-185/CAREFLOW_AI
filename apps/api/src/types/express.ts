import type { AuthenticatedSession } from '../services/auth.service.js';

declare global {
  // Express augments Request through this namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthenticatedSession;
    }
  }
}

export {};
