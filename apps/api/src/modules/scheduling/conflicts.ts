import { Prisma } from '../../generated/prisma/client.js';

export function isOverlapConflict(error: unknown): boolean {
  return (
    errorText(error).includes('23P01') ||
    errorText(error).includes('appointments_no_active_staff_overlap')
  );
}

export function isIdempotencyConflict(error: unknown): boolean {
  return isUniqueConflict(error) && errorText(error).includes('idempotency');
}

export function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) {
    return '';
  }
  const meta = 'meta' in error ? JSON.stringify(error.meta) : '';
  return `${error.message} ${meta}`;
}
