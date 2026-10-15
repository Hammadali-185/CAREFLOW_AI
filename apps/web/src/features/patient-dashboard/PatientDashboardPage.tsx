import type { AppointmentRecord } from '@careflow/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router';
import { EmptyState } from '../../components/feedback/EmptyState';
import { ErrorState } from '../../components/feedback/ErrorState';
import { LoadingSkeleton } from '../../components/feedback/LoadingSkeleton';
import { PageContainer } from '../../components/layout/PageContainer';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { buttonClassName } from '../../components/ui/button-styles';
import { useDocumentTitle } from '../../hooks/use-document-title';
import { useApiClient } from '../../hooks/use-api';
import { ApiError } from '../../lib/api-client';
import { useAuth } from '../auth/auth-session';
import { AppointmentCard } from '../appointments/AppointmentCard';
import { isUpcoming } from '../appointments/appointment-filters';

export function PatientDashboardPage() {
  const auth = useAuth();
  const api = useApiClient();
  const user = auth.user;
  const patient = user?.memberships.some((membership) => membership.role === 'patient') ?? false;
  useDocumentTitle('Home');
  const visits = useQuery({
    queryKey: ['appointments'],
    enabled: patient,
    queryFn: ({ signal }) => api.listAppointments(signal),
  });

  if (user && !patient) {
    return <Navigate to="/clinic" replace />;
  }

  const upcoming = (visits.data ?? []).filter((visit) => isUpcoming(visit));
  const next = upcoming[0];
  const later = upcoming.slice(1, 4);
  const recent = (visits.data ?? [])
    .filter((visit) => !isUpcoming(visit))
    .slice()
    .reverse()
    .slice(0, 3);

  return (
    <PageContainer className="py-6 sm:py-10">
      <PageHeader
        eyebrow="Your care"
        title={user ? `Hello, ${user.displayName}` : 'Hello'}
        description="Book a visit from the form or the assistant. A visit appears here only after the clinic saves it."
        actions={
          <Link to="/book" className={buttonClassName('primary', 'w-full sm:w-auto')}>
            Book appointment
          </Link>
        }
      />
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link to="/assistant" className={buttonClassName('secondary', 'w-full')}>
          Ask the assistant
        </Link>
        <Link to="/book" className={buttonClassName('secondary', 'w-full')}>
          Use the booking form
        </Link>
      </div>
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
      {visits.data && upcoming.length === 0 && recent.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            level={2}
            title="No visits yet"
            description="When you book a visit, the next one will show up here. You can use the form or the assistant."
            action={
              <Link to="/book" className={buttonClassName('primary', 'w-full sm:w-auto')}>
                Book appointment
              </Link>
            }
          />
        </div>
      ) : null}
      {visits.data && (upcoming.length > 0 || recent.length > 0) ? (
        <div className="mt-8 grid gap-8">
          <section aria-labelledby="next-visit-heading">
            <h2 id="next-visit-heading" className="font-display text-2xl font-semibold text-ink">
              Next visit
            </h2>
            {next ? (
              <div className="mt-4">
                <TimedAppointment appointment={next} />
              </div>
            ) : (
              <p className="mt-3 text-base text-ink-soft">You have no upcoming visits.</p>
            )}
          </section>
          {later.length > 0 ? (
            <section aria-labelledby="upcoming-heading">
              <div className="flex items-end justify-between gap-3">
                <h2 id="upcoming-heading" className="font-display text-2xl font-semibold text-ink">
                  Upcoming
                </h2>
                <Link to="/visits" className="text-sm font-semibold text-teal-deep underline">
                  All visits
                </Link>
              </div>
              <ul className="mt-4 grid gap-3 lg:grid-cols-2">
                {later.map((visit) => (
                  <li key={visit.id}>
                    <TimedAppointment appointment={visit} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section aria-labelledby="history-heading">
            <h2 id="history-heading" className="font-display text-2xl font-semibold text-ink">
              Recent history
            </h2>
            {recent.length === 0 ? (
              <p className="mt-3 text-base text-ink-soft">
                Earlier visits will stay on this record.
              </p>
            ) : (
              <ul className="mt-4 grid gap-3 lg:grid-cols-2">
                {recent.map((visit) => (
                  <li key={visit.id}>
                    <TimedAppointment appointment={visit} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </PageContainer>
  );
}

function TimedAppointment({ appointment }: { appointment: AppointmentRecord }) {
  const api = useApiClient();
  const clinic = useQuery({
    queryKey: ['clinic', appointment.clinicId],
    queryFn: ({ signal }) => api.clinic(appointment.clinicId, signal),
  });
  return (
    <AppointmentCard appointment={appointment} timeZone={clinic.data?.clinic.timezone ?? 'UTC'} />
  );
}
