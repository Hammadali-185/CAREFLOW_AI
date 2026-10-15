import type { AppointmentRecord } from '@careflow/shared';
import type { ReactNode } from 'react';
import { Badge } from '../../components/ui/Badge';
import { appointmentStatusLabel, appointmentStatusTone, formatVisitTime } from './format-visit';

export function AppointmentCard({
  appointment,
  timeZone,
  actions,
}: {
  appointment: AppointmentRecord;
  timeZone: string;
  actions?: ReactNode;
}) {
  return (
    <article className="min-w-0 rounded-lg border border-line bg-white p-4 shadow-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Badge tone={appointmentStatusTone(appointment.status)}>
            {appointmentStatusLabel(appointment.status)}
          </Badge>
          <h3 className="mt-2 font-display text-2xl font-semibold tracking-tight text-balance text-ink">
            {appointment.serviceName}
          </h3>
          <p className="mt-2 text-base text-ink">
            {formatVisitTime(appointment.startsAt, timeZone)}
            <span className="text-ink-soft"> · {appointment.durationMinutes} min</span>
          </p>
          <p className="text-sm leading-6 text-ink-soft">
            {appointment.staffName} at {appointment.clinicName}
          </p>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </article>
  );
}
