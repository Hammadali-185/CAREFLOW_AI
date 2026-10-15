import type { AppointmentRecord, AppointmentStatus } from '@careflow/shared';

export type StatusFilter = 'all' | AppointmentStatus;

export function appointmentMatches(visit: AppointmentRecord, query: string, status: StatusFilter) {
  if (status !== 'all' && visit.status !== status) {
    return false;
  }
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return `${visit.serviceName} ${visit.staffName} ${visit.clinicName}`
    .toLowerCase()
    .includes(needle);
}

export function isUpcoming(visit: AppointmentRecord, now = Date.now()) {
  return (
    new Date(visit.startsAt).getTime() >= now &&
    (visit.status === 'requested' || visit.status === 'confirmed')
  );
}
