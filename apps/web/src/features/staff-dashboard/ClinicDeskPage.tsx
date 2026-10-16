import type { AppointmentRecord, AvailabilityWindow } from '@careflow/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '../../components/feedback/Alert';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { LoadingSkeleton } from '../../components/feedback/LoadingSkeleton';
import { PageContainer } from '../../components/layout/PageContainer';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { PageHeader } from '../../components/ui/PageHeader';
import { Select } from '../../components/ui/Select';
import { useAuth } from '../auth/auth-session';
import { useDocumentTitle } from '../../hooks/use-document-title';
import { useApiClient } from '../../hooks/use-api';
import { ApiError } from '../../lib/api-client';
import { ServiceCatalog } from '../services/ServiceCatalog';
import { AppointmentCard } from '../appointments/AppointmentCard';
import { AppointmentDetail } from '../appointments/AppointmentDetail';
import { AppointmentToolbar } from '../appointments/AppointmentToolbar';
import { appointmentMatches, type StatusFilter } from '../appointments/appointment-filters';
import {
  addCivilDays,
  appointmentStatusLabel,
  canChangeAppointment,
  clinicCivilDate,
  clinicMidnightUtc,
  formatVisitTime,
} from '../appointments/format-visit';

const weekdays = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
];

export function ClinicDeskPage() {
  const auth = useAuth();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const clinics = (auth.user?.memberships ?? []).filter(
    (membership) => membership.role === 'owner' || membership.role === 'staff',
  );
  const [clinicId, setClinicId] = useState(clinics[0]?.businessId ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [savingHours, setSavingHours] = useState(false);
  const [dayOffset, setDayOffset] = useState(0);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<AppointmentRecord | null>(null);
  const [pendingCancel, setPendingCancel] = useState(false);
  useDocumentTitle('Clinic desk');

  const clinic = useQuery({
    queryKey: ['clinic', clinicId],
    enabled: Boolean(clinicId),
    queryFn: ({ signal }) => api.clinic(clinicId, signal),
  });
  const staff = useQuery({
    queryKey: ['staff', clinicId],
    enabled: Boolean(clinicId),
    queryFn: ({ signal }) => api.listStaff(clinicId, signal),
  });
  const selfId = auth.user?.id ?? '';
  const isOwner =
    clinics.find((membership) => membership.businessId === clinicId)?.role === 'owner';
  const staffUserId = staff.data?.some((person) => person.userId === selfId)
    ? selfId
    : (staff.data?.[0]?.userId ?? '');
  const [chosenStaff, setChosenStaff] = useState('');
  const activeStaff = isOwner ? chosenStaff || staffUserId : selfId;
  const timeZone = clinic.data?.clinic.timezone ?? '';
  const today = timeZone ? clinicCivilDate(timeZone) : '';
  const schedule = useQuery({
    queryKey: ['schedule', clinicId, activeStaff, today],
    enabled: Boolean(clinicId && activeStaff && timeZone),
    queryFn: ({ signal }) =>
      api.schedule(
        clinicId,
        activeStaff,
        {
          from: clinicMidnightUtc(today, timeZone).toISOString(),
          to: clinicMidnightUtc(addCivilDays(today, 7), timeZone).toISOString(),
        },
        signal,
      ),
  });
  const availability = useQuery({
    queryKey: ['availability', clinicId, activeStaff],
    enabled: Boolean(clinicId && activeStaff),
    queryFn: ({ signal }) => api.availability(clinicId, activeStaff, signal),
  });

  if (clinics.length === 0) {
    return (
      <PageContainer className="py-8 sm:py-12">
        <Alert tone="warning" title="Clinic desk is for staff">
          This account does not have a staff or administrator membership.
        </Alert>
      </PageContainer>
    );
  }

  const zone = timeZone || 'UTC';
  const days = today ? Array.from({ length: 7 }, (_, index) => addCivilDays(today, index)) : [];
  const selectedDay = days[Math.min(dayOffset, Math.max(days.length - 1, 0))] ?? today;
  const dayVisits = (schedule.data?.appointments ?? []).filter(
    (visit) => clinicCivilDate(zone, new Date(visit.startsAt)) === selectedDay,
  );
  const visibleVisits = dayVisits.filter((visit) => appointmentMatches(visit, query, status));
  const todayCount = (schedule.data?.appointments ?? []).filter(
    (visit) =>
      clinicCivilDate(zone, new Date(visit.startsAt)) === today &&
      (visit.status === 'requested' || visit.status === 'confirmed'),
  ).length;
  const selected = (schedule.data?.appointments ?? []).find((visit) => visit.id === selectedId);

  async function cancelVisit() {
    if (!cancelling || !auth.csrfToken) {
      setMessage('Sign in to continue.');
      return;
    }
    setPendingCancel(true);
    setMessage(null);
    try {
      await api.cancelAppointment(cancelling.id, auth.csrfToken);
      setCancelling(null);
      setSelectedId(null);
      await queryClient.invalidateQueries({ queryKey: ['schedule', clinicId] });
      await queryClient.invalidateQueries({ queryKey: ['appointments'] });
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : 'The cancellation did not finish. The visit is unchanged.',
      );
    } finally {
      setPendingCancel(false);
    }
  }

  async function saveHours(windows: AvailabilityWindow[]) {
    if (!auth.csrfToken || !activeStaff) {
      setMessage('Sign in to continue.');
      return;
    }
    setSavingHours(true);
    setMessage(null);
    try {
      await api.replaceAvailability(clinicId, activeStaff, { windows }, auth.csrfToken);
      await queryClient.invalidateQueries({ queryKey: ['availability', clinicId, activeStaff] });
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Those hours were not saved.');
    } finally {
      setSavingHours(false);
    }
  }

  return (
    <PageContainer className="py-8 sm:py-12">
      <PageHeader
        eyebrow="Staff"
        title="Clinic desk"
        description="Today's visits, the next seven clinic days, services, and weekly hours."
      />
      {clinics.length > 1 ? (
        <div className="mt-6 max-w-md">
          <FormField id="desk-clinic" label="Clinic">
            <Select
              id="desk-clinic"
              value={clinicId}
              onChange={(event) => setClinicId(event.target.value)}
            >
              {clinics.map((membership) => (
                <option key={membership.businessId} value={membership.businessId}>
                  {membership.businessName}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
      ) : null}
      {message ? (
        <div className="mt-6">
          <Alert tone="danger" title="That change did not go through">
            {message}
          </Alert>
        </div>
      ) : null}
      <div className="mt-8 grid min-w-0 gap-10">
        <ServiceCatalog clinicId={clinicId} csrfToken={auth.csrfToken} onMessage={setMessage} />

        <section aria-labelledby="today-heading" aria-label="Today" className="min-w-0">
          <h2 id="today-heading" className="font-display text-2xl font-semibold text-ink">
            Today
          </h2>
          <p className="mt-2 text-4xl font-semibold tracking-tight text-ink">
            {schedule.data ? todayCount : '—'}
          </p>
          <p className="text-sm text-ink-soft">
            Requested and confirmed visits on the clinic calendar.
          </p>
        </section>

        <section aria-labelledby="schedule-heading" className="min-w-0">
          <h2 id="schedule-heading" className="font-display text-2xl font-semibold text-ink">
            Daily schedule
          </h2>
          {isOwner && staff.data && staff.data.length > 1 ? (
            <div className="mt-4 max-w-md">
              <FormField id="desk-staff" label="Staff member">
                <Select
                  id="desk-staff"
                  value={activeStaff}
                  onChange={(event) => setChosenStaff(event.target.value)}
                >
                  {staff.data.map((person) => (
                    <option key={person.userId} value={person.userId}>
                      {person.displayName}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
          ) : null}
          {schedule.isPending ? (
            <div className="mt-4">
              <LoadingSkeleton label="Loading the schedule" />
            </div>
          ) : null}
          {days.length > 0 ? (
            <div
              className="mt-4 flex min-w-0 max-w-full gap-2 overflow-x-auto pb-1"
              role="group"
              aria-label="Clinic days"
            >
              {days.map((day, index) => (
                <Button
                  key={day}
                  variant={day === selectedDay ? 'primary' : 'secondary'}
                  aria-pressed={day === selectedDay}
                  className="shrink-0"
                  onClick={() => setDayOffset(index)}
                >
                  {dayLabel(day, zone)}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="mt-4">
            <AppointmentToolbar
              query={query}
              status={status}
              onQuery={setQuery}
              onStatus={setStatus}
            />
          </div>
          {schedule.isError ? (
            <div className="mt-4">
              <ErrorState
                level={2}
                title="That schedule is unavailable"
                description={
                  schedule.error instanceof ApiError
                    ? schedule.error.message
                    : 'The schedule did not load.'
                }
                action={<Button onClick={() => void schedule.refetch()}>Try again</Button>}
              />
            </div>
          ) : null}
          {selected ? (
            <div className="mt-4">
              <AppointmentDetail
                appointment={selected}
                timeZone={zone}
                onClose={() => setSelectedId(null)}
                actions={
                  canChangeAppointment(selected.status, selected.startsAt) ? (
                    <Button variant="ghost" onClick={() => setCancelling(selected)}>
                      Cancel visit
                    </Button>
                  ) : null
                }
              />
            </div>
          ) : null}
          {schedule.data ? (
            visibleVisits.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  level={2}
                  title={
                    query.trim() || status !== 'all' ? 'No matching visits' : 'No visits this day'
                  }
                  description={
                    query.trim() || status !== 'all'
                      ? 'Try another name or status. The schedule is unchanged.'
                      : 'Open another clinic day, or check weekly hours if the calendar should have time.'
                  }
                />
              </div>
            ) : (
              <div className="mt-4 min-w-0 max-w-full overflow-x-auto">
                <table className="hidden w-full min-w-[40rem] border-separate border-spacing-y-2 text-left lg:table">
                  <caption className="sr-only">Visits on {dayLabel(selectedDay, zone)}</caption>
                  <thead>
                    <tr className="text-sm text-ink-soft">
                      <th className="px-3 font-semibold">When</th>
                      <th className="px-3 font-semibold">Patient</th>
                      <th className="px-3 font-semibold">Service</th>
                      <th className="px-3 font-semibold">Staff</th>
                      <th className="px-3 font-semibold">Status</th>
                      <th className="px-3 font-semibold">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleVisits.map((appointment) => (
                      <ScheduleTableRow
                        key={appointment.id}
                        appointment={appointment}
                        timeZone={zone}
                        onDetails={() => setSelectedId(appointment.id)}
                        onCancel={
                          canChangeAppointment(appointment.status, appointment.startsAt)
                            ? () => setCancelling(appointment)
                            : undefined
                        }
                      />
                    ))}
                  </tbody>
                </table>
                <ul className="grid gap-3 lg:hidden">
                  {visibleVisits.map((appointment) => (
                    <li key={appointment.id}>
                      <AppointmentCard
                        appointment={appointment}
                        timeZone={zone}
                        actions={
                          <>
                            <Button
                              variant="secondary"
                              onClick={() => setSelectedId(appointment.id)}
                            >
                              Details
                            </Button>
                            {canChangeAppointment(appointment.status, appointment.startsAt) ? (
                              <Button variant="ghost" onClick={() => setCancelling(appointment)}>
                                Cancel visit
                              </Button>
                            ) : null}
                          </>
                        }
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )
          ) : null}
        </section>

        {availability.isError ? (
          <ErrorState
            level={2}
            title="Weekly hours could not be loaded"
            description={
              availability.error instanceof ApiError
                ? availability.error.message
                : 'Those hours did not load.'
            }
          />
        ) : (
          <HoursEditor
            windows={availability.data?.windows ?? []}
            pending={savingHours}
            onSave={(windows) => void saveHours(windows)}
          />
        )}
      </div>
      <ConfirmDialog
        open={Boolean(cancelling)}
        title="Cancel this visit?"
        description="The clinic will release this time. The visit stays as it is until the cancellation is saved."
        confirmLabel={pendingCancel ? 'Cancelling…' : 'Cancel visit'}
        onClose={() => {
          if (!pendingCancel) {
            setCancelling(null);
          }
        }}
        onConfirm={() => {
          void cancelVisit();
        }}
      />
    </PageContainer>
  );
}

function ScheduleTableRow({
  appointment,
  timeZone,
  onDetails,
  onCancel,
}: {
  appointment: AppointmentRecord;
  timeZone: string;
  onDetails: () => void;
  onCancel?: () => void;
}) {
  return (
    <tr className="bg-white">
      <td className="rounded-l-md border-y border-l border-line px-3 py-3 whitespace-nowrap">
        {formatVisitTime(appointment.startsAt, timeZone)}
      </td>
      <td className="border-y border-line px-3 py-3">
        <div>{appointment.patientContactName ?? '—'}</div>
        {appointment.patientPhone ? (
          <div className="text-sm text-ink-soft">{appointment.patientPhone}</div>
        ) : null}
      </td>
      <td className="border-y border-line px-3 py-3">{appointment.serviceName}</td>
      <td className="border-y border-line px-3 py-3">{appointment.staffName}</td>
      <td className="border-y border-line px-3 py-3">
        {appointmentStatusLabel(appointment.status)}
      </td>
      <td className="rounded-r-md border-y border-r border-line px-3 py-3">
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onDetails}>
            Details
          </Button>
          {onCancel ? (
            <Button variant="ghost" onClick={onCancel}>
              Cancel visit
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function dayLabel(date: string, timeZone: string) {
  if (!date) {
    return '';
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(clinicMidnightUtc(date, timeZone));
}

function HoursEditor({
  windows,
  pending,
  onSave,
}: {
  windows: AvailabilityWindow[];
  pending: boolean;
  onSave: (windows: AvailabilityWindow[]) => void;
}) {
  const [rows, setRows] = useState<AvailabilityWindow[] | null>(null);
  const current = rows ?? windows;

  return (
    <section aria-labelledby="hours-heading" className="max-w-2xl min-w-0">
      <h2 id="hours-heading" className="font-display text-2xl font-semibold text-ink">
        Weekly hours
      </h2>
      <p className="mt-2 text-sm leading-6 text-ink-soft">
        Hours are clinic local time. Saving replaces the whole weekly schedule for this person.
      </p>
      <ul className="mt-4 grid gap-3">
        {current.map((window, index) => (
          <li
            key={`${window.weekday}-${index}`}
            className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_8rem_auto]"
          >
            <Select
              aria-label={`Weekday ${index + 1}`}
              value={String(window.weekday)}
              onChange={(event) => updateRow(index, { weekday: Number(event.target.value) })}
            >
              {weekdays.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </Select>
            <Input
              aria-label={`Start ${index + 1}`}
              type="time"
              value={minutesToTime(window.startsMinute)}
              onChange={(event) =>
                updateRow(index, { startsMinute: timeToMinutes(event.target.value) })
              }
            />
            <Input
              aria-label={`End ${index + 1}`}
              type="time"
              value={minutesToTime(window.endsMinute)}
              onChange={(event) =>
                updateRow(index, { endsMinute: timeToMinutes(event.target.value) })
              }
            />
            <Button
              variant="ghost"
              onClick={() => setRows(current.filter((_, rowIndex) => rowIndex !== index))}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button
          variant="secondary"
          onClick={() =>
            setRows([...current, { weekday: 1, startsMinute: 9 * 60, endsMinute: 17 * 60 }])
          }
        >
          Add hours
        </Button>
        <Button disabled={pending} onClick={() => onSave(current)}>
          {pending ? 'Saving…' : 'Save hours'}
        </Button>
      </div>
    </section>
  );

  function updateRow(index: number, patch: Partial<AvailabilityWindow>) {
    setRows(current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }
}

function minutesToTime(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function timeToMinutes(value: string) {
  const [hours = 0, minutes = 0] = value.split(':').map(Number);
  return hours * 60 + minutes;
}
