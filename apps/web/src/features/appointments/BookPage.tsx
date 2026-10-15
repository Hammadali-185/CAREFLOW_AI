import type { AppointmentRecord, Slot } from '@careflow/shared';
import { useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Alert } from '../../components/feedback/Alert';
import { ErrorState } from '../../components/feedback/ErrorState';
import { LoadingSkeleton } from '../../components/feedback/LoadingSkeleton';
import { PageContainer } from '../../components/layout/PageContainer';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { Select } from '../../components/ui/Select';
import { useAuth } from '../auth/auth-session';
import { useDocumentTitle } from '../../hooks/use-document-title';
import { useApiClient } from '../../hooks/use-api';
import { ApiError } from '../../lib/api-client';
import { AppointmentCard } from './AppointmentCard';
import { clinicCivilDate, createIdempotencyKey, formatVisitTime } from './format-visit';
import { VisitPlanner, type VisitDraft } from './VisitPlanner';

export function BookPage() {
  const auth = useAuth();
  const api = useApiClient();
  const patientClinics = (auth.user?.memberships ?? []).filter(
    (membership) => membership.role === 'patient',
  );
  const [params] = useSearchParams();
  const [clinicId, setClinicId] = useState(patientClinics[0]?.businessId ?? '');
  const requestedDate = params.get('date') ?? '';
  const [draft, setDraft] = useState<VisitDraft>({
    serviceId: params.get('serviceId') ?? '',
    date: /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : '',
    staffUserId: '',
    slot: null,
  });
  const [reviewing, setReviewing] = useState(false);
  const [booked, setBooked] = useState<AppointmentRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const idempotency = useRef<{ signature: string; key: string } | null>(null);
  useDocumentTitle('Book a visit');

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

  if (patientClinics.length === 0) {
    return (
      <PageContainer className="py-8 sm:py-12">
        <ErrorState
          title="Booking is for patients"
          description="This account does not have a patient membership. Staff can still open the clinic desk."
        />
      </PageContainer>
    );
  }

  const timeZone = clinic.data?.clinic.timezone ?? 'UTC';
  const ready = Boolean(services.data && staff.data && clinic.data);

  async function confirm(slot: Slot) {
    if (!auth.csrfToken) {
      setError('Sign in to continue.');
      return;
    }
    const signature = `${clinicId}|${draft.serviceId}|${slot.staffUserId}|${slot.startsAt}`;
    if (idempotency.current?.signature !== signature) {
      idempotency.current = { signature, key: createIdempotencyKey() };
    }
    setPending(true);
    setError(null);
    try {
      const result = await api.createAppointment(
        clinicId,
        { serviceId: draft.serviceId, staffUserId: slot.staffUserId, startsAt: slot.startsAt },
        auth.csrfToken,
        idempotency.current.key,
      );
      setBooked(result.appointment);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'The booking did not finish. Your choices are still on this page.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <PageContainer className="py-8 sm:py-12">
      <PageHeader
        eyebrow="Patient booking"
        title="Book a visit"
        description="Pick a service, a date, and an open time. The visit is saved only after you confirm and the clinic accepts it."
      />
      {patientClinics.length > 1 ? (
        <div className="mt-6 max-w-md">
          <label className="grid gap-2 text-sm font-semibold text-ink" htmlFor="booking-clinic">
            Clinic
            <Select
              id="booking-clinic"
              value={clinicId}
              onChange={(event) => {
                setClinicId(event.target.value);
                setDraft({
                  serviceId: '',
                  date: clinicCivilDate(timeZone),
                  staffUserId: '',
                  slot: null,
                });
                setReviewing(false);
                setBooked(null);
                setError(null);
              }}
            >
              {patientClinics.map((membership) => (
                <option key={membership.businessId} value={membership.businessId}>
                  {membership.businessName}
                </option>
              ))}
            </Select>
          </label>
        </div>
      ) : null}

      {!ready && !services.isError && !staff.isError && !clinic.isError ? (
        <div className="mt-8">
          <LoadingSkeleton label="Loading the clinic schedule" />
        </div>
      ) : null}
      {services.isError || staff.isError || clinic.isError ? (
        <div className="mt-8">
          <Alert tone="danger" title="The clinic schedule did not load">
            The form will stay here. Check your connection and try the page again.
          </Alert>
        </div>
      ) : null}

      {ready && booked ? (
        <div className="mt-8 grid max-w-2xl gap-4">
          <Alert tone="success" title="Your visit is booked">
            The clinic saved this appointment.
          </Alert>
          <AppointmentCard appointment={booked} timeZone={timeZone} />
          <Link to="/visits" className="text-base font-semibold text-teal-deep">
            View your visits
          </Link>
        </div>
      ) : null}

      {ready && !booked ? (
        <div className="mt-8 grid max-w-2xl gap-6">
          <VisitPlanner
            clinicId={clinicId}
            timeZone={timeZone}
            services={services.data ?? []}
            staff={staff.data ?? []}
            draft={draft.date ? draft : { ...draft, date: clinicCivilDate(timeZone) }}
            onChange={(next) => {
              setDraft(next);
              setReviewing(false);
              setError(null);
            }}
          />
          {draft.slot ? (
            <section
              aria-labelledby="review-heading"
              className="rounded-lg border border-line bg-white p-5 shadow-card"
            >
              <h2 id="review-heading" className="font-display text-2xl font-semibold text-ink">
                Review
              </h2>
              <p className="mt-3 text-base leading-7 text-ink">
                {services.data?.find((service) => service.id === draft.serviceId)?.name} with{' '}
                {draft.slot.staffName}
              </p>
              <p className="text-sm text-ink-soft">
                {formatVisitTime(draft.slot.startsAt, timeZone)}
              </p>
              {reviewing ? (
                <div className="mt-4 grid gap-3">
                  {error ? (
                    <Alert tone="danger" title="The visit was not booked">
                      {error}
                    </Alert>
                  ) : null}
                  <p className="text-sm leading-6 text-ink-soft">
                    Confirming sends this exact time to the clinic. Nothing is booked until the
                    clinic accepts it.
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button disabled={pending} onClick={() => void confirm(draft.slot as Slot)}>
                      {pending ? 'Booking…' : 'Confirm booking'}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setReviewing(false)}
                      disabled={pending}
                    >
                      Back
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-4">
                  <Button onClick={() => setReviewing(true)}>Review booking</Button>
                </div>
              )}
            </section>
          ) : null}
        </div>
      ) : null}
    </PageContainer>
  );
}
