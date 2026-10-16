import type { AppointmentRecord } from '@careflow/shared';
import { useEffect, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { appointmentStatusLabel, formatVisitTime } from './format-visit';

export function AppointmentDetail({
  appointment,
  timeZone,
  onClose,
  actions,
}: {
  appointment: AppointmentRecord;
  timeZone: string;
  onClose: () => void;
  actions?: ReactNode;
}) {
  useEffect(() => {
    document.getElementById('visit-detail-heading')?.scrollIntoView({ block: 'start' });
  }, []);

  return (
    <section
      aria-labelledby="visit-detail-heading"
      className="min-w-0 scroll-mt-24 rounded-lg border border-line bg-white p-4 shadow-card"
    >
      <h2 id="visit-detail-heading" className="font-display text-2xl font-semibold text-ink">
        Visit details
      </h2>
      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <Detail label="Service" value={appointment.serviceName} />
        <Detail label="Status" value={appointmentStatusLabel(appointment.status)} />
        <Detail label="When" value={formatVisitTime(appointment.startsAt, timeZone)} />
        <Detail label="Length" value={`${appointment.durationMinutes} min`} />
        <Detail label="Staff" value={appointment.staffName} />
        <Detail label="Clinic" value={appointment.clinicName} />
        {appointment.patientContactName ? (
          <Detail label="Patient" value={appointment.patientContactName} />
        ) : null}
        {appointment.patientPhone ? (
          <Detail label="Phone" value={appointment.patientPhone} />
        ) : null}
        {appointment.cancelledAt ? (
          <Detail label="Cancelled" value={formatVisitTime(appointment.cancelledAt, timeZone)} />
        ) : null}
      </dl>
      {actions ? <div className="mt-4 flex flex-col gap-2 sm:flex-row">{actions}</div> : null}
      <div className="mt-4">
        <Button variant="secondary" onClick={onClose}>
          Close details
        </Button>
      </div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm font-semibold text-ink-soft">{label}</dt>
      <dd className="text-base break-words text-ink">{value}</dd>
    </div>
  );
}
