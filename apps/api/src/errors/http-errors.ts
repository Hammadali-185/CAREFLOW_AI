import { AppError } from './app-error.js';

export class UnauthenticatedError extends AppError {
  constructor() {
    super(401, 'UNAUTHENTICATED', 'Sign in to continue.');
  }
}

export class AuthenticationFailedError extends AppError {
  constructor() {
    super(401, 'AUTHENTICATION_FAILED', 'The email or password is incorrect.');
  }
}

export class ForbiddenError extends AppError {
  constructor() {
    super(403, 'FORBIDDEN', 'You do not have permission to do that.');
  }
}

export class CsrfRejectedError extends AppError {
  constructor() {
    super(403, 'CSRF_REJECTED', 'This request was rejected.');
  }
}

export class AccountExistsError extends AppError {
  constructor() {
    super(409, 'ACCOUNT_EXISTS', 'An account with that email already exists.');
  }
}

export class UnknownClinicError extends AppError {
  constructor() {
    super(400, 'UNKNOWN_CLINIC', 'That clinic could not be found.');
  }
}

export class RateLimitedError extends AppError {
  constructor() {
    super(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
  }
}

export class SlotTakenError extends AppError {
  constructor() {
    super(409, 'SLOT_TAKEN', 'That time was just booked. Choose another.');
  }
}

export class SlotUnavailableError extends AppError {
  constructor() {
    super(409, 'SLOT_UNAVAILABLE', 'That time is not available.');
  }
}

export class AppointmentNotEligibleError extends AppError {
  constructor() {
    super(409, 'NOT_ELIGIBLE', 'This appointment can no longer be changed.');
  }
}

export class IdempotencyMismatchError extends AppError {
  constructor() {
    super(409, 'IDEMPOTENCY_MISMATCH', 'That booking key was already used for a different visit.');
  }
}

export class ConfirmationRequiredError extends AppError {
  constructor() {
    super(409, 'CONFIRMATION_REQUIRED', 'Choose a time and confirm it before a visit is saved.');
  }
}

export class OutsideBookingWindowError extends AppError {
  constructor() {
    super(400, 'OUTSIDE_BOOKING_WINDOW', 'That date is outside the booking window.');
  }
}
