import type { AppointmentRecord, Slot } from '@careflow/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Alert } from '../../components/feedback/Alert';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { LoadingSkeleton } from '../../components/feedback/LoadingSkeleton';
import { PageContainer } from '../../components/layout/PageContainer';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { buttonClassName } from '../../components/ui/button-styles';
import { useAuth } from '../auth/auth-session';
import { useDocumentTitle } from '../../hooks/use-document-title';
import { useApiClient } from '../../hooks/use-api';
import { ApiError } from '../../lib/api-client';
import { AppointmentCard } from './AppointmentCard';
import { AppointmentDetail } from './AppointmentDetail';
import { AppointmentToolbar } from './AppointmentToolbar';
import { appointmentMatches, isUpcoming, type StatusFilter } from './appointment-filters';
import { canChangeAppointment } from './format-visit';
import { VisitPlanner, type VisitDraft } from './VisitPlanner';

export function VisitsPage() {
  const api = useApiClient();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState<AppointmentRecord | null>(null);
  const [moving, setMoving] = useState<AppointmentRecord | null>(null);
  const [draft, setDraft] = useState<VisitDraft>({
    serviceId: '',
    date: '',
    staffUserId: '',
    slot: null,
  });
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useDocumentTitle('Your visits');

  const visits = useQuery({
    queryKey: ['appointments'],
    queryFn: ({ signal }) => api.listAppointments(signal),
  });
  const clinicId = moving?.clinicId ?? '';
  const clinic = useQuery({
    queryKey: ['clinic', clinicId],
    enabled: Boolean(clinicId),
    queryFn: ({ signal }) => api.clinic(clinicId, signal),
  });
  const services = useQuery({
    queryKey: ['services', clinicId],
    enabled: Boolean(clinicId),
    queryFn: ({ signal }) => api.listServices(clinicId, signal),
  });
  const staff = useQuery({
    queryKey: ['staff', clinicId],
    enabled: Boolean(clinicId),
    queryFn: ({ signal }) => api.listStaff(clinicId, signal),
  });

  const upcoming = (visits.data ?? []).filter((visit) => isUpcoming(visit));
  const past = (visits.data ?? []).filter((visit) => !upcoming.includes(visit));
  const visible = (scope === 'upcoming' ? upcoming : past).filter((visit) =>
    appointmentMatches(visit, query, status),
  );
  const selected = (visits.data ?? []).find((visit) => visit.id === selectedId) ?? null;

  async function cancelVisit() {
    if (!cancelling || !auth.csrfToken) {
      setMessage('Sign in to continue.');
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      await api.cancelAppointment(cancelling.id, auth.csrfToken);
      setCancelling(null);
      await queryClient.invalidateQueries({ queryKey: ['appointments'] });
    } catch (error) {
      setCancelling(null);
      setMessage(
        error instanceof ApiError
          ? error.message
          : 'The cancellation did not finish. The visit is unchanged.',
      );
    } finally {
      setPending(false);
    }
  }

  async function reschedule(slot: Slot) {
    if (!moving || !auth.csrfToken) {
      setMessage('Sign in to continue.');
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      await api.rescheduleAppointment(
        moving.id,
        { staffUserId: slot.staffUserId, startsAt: slot.startsAt },
        auth.csrfToken,
      );
      await queryClient.invalidateQueries({ queryKey: ['appointments'] });
      setMoving(null);
    } catch (error) {
      setMessage(
        error instanceof ApiError
          ? error.message
          : 'The new time was not saved. The original visit is unchanged.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <PageContainer className="py-8 sm:py-12">
      <PageHeader
        eyebrow="Your care"
        title="Your visits"
        description="Upcoming visits can be cancelled or moved. Past visits stay on the record."
        actions={
          <Link to="/book" className={buttonClassName('primary', 'w-full sm:w-auto')}>
            Book a visit
          </Link>
        }
      />
      {message ? (
        <div className="mt-6">
          <Alert tone="danger" title="That change did not go through">
            {message}
          </Alert>
        </div>
      ) : null}
      {visits.isPending ? (
        <div className="mt-8">
          <LoadingSkeleton label="Loading your visits" />
        </div>
      ) : null}
      {visits.isError ? (
        <div className="mt-8">
          <ErrorState
            level={2}
            title="Your visits could not be loaded"
            description={
              visits.error instanceof ApiError
                ? visits.error.message
                : 'The clinic did not respond. Try again in a moment.'
            }
            action={<Button onClick={() => void visits.refetch()}>Try again</Button>}
          />
        </div>
      ) : null}
      {visits.data ? (
        <div className="mt-8 grid gap-8">
          <div className="flex flex-col gap-2 sm:flex-row" role="group" aria-label="Visit list">
            <Button
              variant={scope === 'upcoming' ? 'primary' : 'secondary'}
              aria-pressed={scope === 'upcoming'}
              onClick={() => setScope('upcoming')}
            >
              Upcoming
            </Button>
            <Button
              variant={scope === 'past' ? 'primary' : 'secondary'}
              aria-pressed={scope === 'past'}
              onClick={() => setScope('past')}
            >
              Past
            </Button>
          </div>
          <AppointmentToolbar
            query={query}
            status={status}
            onQuery={setQuery}
            onStatus={setStatus}
          />
          {selected ? (
            <SelectedVisit
              appointment={selected}
              onClose={() => setSelectedId(null)}
              onCancel={setCancelling}
              onMove={(visit) => {
                setMessage(null);
                setMoving(visit);
                setDraft({
                  serviceId: visit.serviceId,
                  date: '',
                  staffUserId: visit.staffUserId,
                  slot: null,
                });
              }}
            />
          ) : null}
          <VisitList
            title={scope === 'upcoming' ? 'Upcoming' : 'Past'}
            empty={
              scope === 'upcoming' ? 'You have no upcoming visits.' : 'You have no earlier visits.'
            }
            filtered={query.trim().length > 0 || status !== 'all'}
            visits={visible}
            onCancel={scope === 'upcoming' ? setCancelling : undefined}
            pending={pending}
            onMove={
              scope === 'upcoming'
                ? (visit) => {
                    setMessage(null);
                    setMoving(visit);
                    setDraft({
                      serviceId: visit.serviceId,
                      date: '',
                      staffUserId: visit.staffUserId,
                      slot: null,
                    });
                  }
                : undefined
            }
            onDetails={setSelectedId}
          />
          {moving && clinic.data && services.data && staff.data ? (
            <section aria-labelledby="reschedule-heading" className="max-w-2xl">
              <h2 id="reschedule-heading" className="font-display text-2xl font-semibold text-ink">
                Choose a new time
              </h2>
              <p className="mt-2 text-sm leading-6 text-ink-soft">
                The original visit stays in place until the clinic accepts the new time.
              </p>
              <div className="mt-4">
                <VisitPlanner
                  clinicId={moving.clinicId}
                  timeZone={clinic.data.clinic.timezone}
                  services={services.data}
                  staff={staff.data}
                  draft={draft}
                  lockService
                  onChange={setDraft}
                />
              </div>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button
                  disabled={!draft.slot || pending}
                  onClick={() => draft.slot && void reschedule(draft.slot)}
                >
                  {pending ? 'Saving…' : 'Confirm new time'}
                </Button>
                <Button variant="secondary" onClick={() => setMoving(null)} disabled={pending}>
                  Keep original time
                </Button>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(cancelling)}
        title="Cancel this visit?"
        description="The clinic will release this time. You can book another visit afterward."
        confirmLabel={pending ? 'Cancelling…' : 'Cancel visit'}
        onClose={() => {
          if (!pending) {
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

function VisitList({
  title,
  empty,
  filtered,
  visits,
  onCancel,
  onMove,
  onDetails,
  pending = false,
}: {
  title: string;
  empty: string;
  filtered: boolean;
  visits: AppointmentRecord[];
  onCancel?: (visit: AppointmentRecord) => void;
  onMove?: (visit: AppointmentRecord) => void;
  onDetails: (id: string) => void;
  pending?: boolean;
}) {
  return (
    <section aria-labelledby={`${title}-heading`}>
      <h2 id={`${title}-heading`} className="font-display text-2xl font-semibold text-ink">
        {title}
      </h2>
      {visits.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            level={2}
            title={filtered ? 'No matching visits' : empty}
            description={
              filtered
                ? 'Try another name or status. The list is unchanged.'
                : 'Book a visit when you are ready. Nothing is saved until you confirm it.'
            }
            action={
              filtered ? undefined : (
                <Link to="/book" className={buttonClassName('primary', 'w-full sm:w-auto')}>
                  Book a visit
                </Link>
              )
            }
          />
        </div>
      ) : (
        <ul className="mt-4 grid gap-3">
          {visits.map((visit) => (
            <li key={visit.id}>
              <TimedAppointment
                appointment={visit}
                actions={
                  <>
                    <Button variant="secondary" onClick={() => onDetails(visit.id)}>
                      Details
                    </Button>
                    {onCancel && onMove && canChangeAppointment(visit.status, visit.startsAt) ? (
                      <>
                        <Button
                          variant="secondary"
                          disabled={pending}
                          onClick={() => onMove(visit)}
                        >
                          Reschedule
                        </Button>
                        <Button variant="ghost" disabled={pending} onClick={() => onCancel(visit)}>
                          Cancel visit
                        </Button>
                      </>
                    ) : null}
                  </>
                }
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SelectedVisit({
  appointment,
  onClose,
  onCancel,
  onMove,
}: {
  appointment: AppointmentRecord;
  onClose: () => void;
  onCancel: (visit: AppointmentRecord) => void;
  onMove: (visit: AppointmentRecord) => void;
}) {
  const api = useApiClient();
  const clinic = useQuery({
    queryKey: ['clinic', appointment.clinicId],
    queryFn: ({ signal }) => api.clinic(appointment.clinicId, signal),
  });
  const changeable = canChangeAppointment(appointment.status, appointment.startsAt);
  return (
    <AppointmentDetail
      appointment={appointment}
      timeZone={clinic.data?.clinic.timezone ?? 'UTC'}
      onClose={onClose}
      actions={
        changeable ? (
          <>
            <Button variant="secondary" onClick={() => onMove(appointment)}>
              Reschedule
            </Button>
            <Button variant="ghost" onClick={() => onCancel(appointment)}>
              Cancel visit
            </Button>
          </>
        ) : null
      }
    />
  );
}

function TimedAppointment({
  appointment,
  actions,
}: {
  appointment: AppointmentRecord;
  actions?: ReactNode;
}) {
  const api = useApiClient();
  const clinic = useQuery({
    queryKey: ['clinic', appointment.clinicId],
    queryFn: ({ signal }) => api.clinic(appointment.clinicId, signal),
  });
  return (
    <AppointmentCard
      appointment={appointment}
      timeZone={clinic.data?.clinic.timezone ?? 'UTC'}
      actions={actions}
    />
  );
}
