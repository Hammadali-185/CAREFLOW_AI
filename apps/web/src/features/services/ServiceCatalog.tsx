import type { ServiceRecord } from '@careflow/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorState } from '../../components/feedback/ErrorState';
import { LoadingSkeleton } from '../../components/feedback/LoadingSkeleton';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { useApiClient } from '../../hooks/use-api';
import { ApiError } from '../../lib/api-client';

export function ServiceCatalog({
  clinicId,
  csrfToken,
  onMessage,
}: {
  clinicId: string;
  csrfToken: string | null;
  onMessage: (message: string | null) => void;
}) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [serviceName, setServiceName] = useState('');
  const [duration, setDuration] = useState('30');
  const [savingService, setSavingService] = useState(false);
  const [servicePendingId, setServicePendingId] = useState<string | null>(null);
  const services = useQuery({
    queryKey: ['services', clinicId],
    enabled: Boolean(clinicId),
    queryFn: ({ signal }) => api.listServices(clinicId, signal),
  });

  async function setServiceActive(service: ServiceRecord, active: boolean) {
    if (!csrfToken) {
      onMessage('Sign in to continue.');
      return;
    }
    setServicePendingId(service.id);
    onMessage(null);
    try {
      await api.updateService(clinicId, service.id, { active }, csrfToken);
      await queryClient.invalidateQueries({ queryKey: ['services', clinicId] });
    } catch (error) {
      onMessage(error instanceof ApiError ? error.message : 'The service was not changed.');
    } finally {
      setServicePendingId(null);
    }
  }

  async function addService() {
    if (!csrfToken) {
      onMessage('Sign in to continue.');
      return;
    }
    const durationMinutes = Number(duration);
    setSavingService(true);
    onMessage(null);
    try {
      await api.createService(clinicId, { name: serviceName, durationMinutes }, csrfToken);
      setServiceName('');
      await queryClient.invalidateQueries({ queryKey: ['services', clinicId] });
    } catch (error) {
      onMessage(error instanceof ApiError ? error.message : 'The service was not saved.');
    } finally {
      setSavingService(false);
    }
  }

  return (
    <section aria-labelledby="services-heading" className="max-w-2xl min-w-0">
      <h2 id="services-heading" className="font-display text-2xl font-semibold text-ink">
        Services
      </h2>
      {services.isPending ? <LoadingSkeleton label="Loading services" /> : null}
      {services.isError ? (
        <div className="mt-4">
          <ErrorState
            level={2}
            title="Services could not be loaded"
            description={
              services.error instanceof ApiError
                ? services.error.message
                : 'The service list did not load.'
            }
          />
        </div>
      ) : null}
      <ul className="mt-4 grid gap-2">
        {(services.data ?? []).map((service) => (
          <li
            key={service.id}
            className="flex flex-col gap-3 rounded-md border border-line bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-semibold text-ink">{service.name}</p>
              <p className="text-sm text-ink-soft">
                {service.durationMinutes} min ·{' '}
                {service.active ? 'Offered' : 'Hidden from patients'}
              </p>
            </div>
            <Button
              variant="secondary"
              disabled={servicePendingId === service.id}
              onClick={() => void setServiceActive(service, !service.active)}
            >
              {service.active ? 'Hide from patients' : 'Offer again'}
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void addService();
        }}
      >
        <FormField id="service-name" label="New service">
          <Input
            id="service-name"
            value={serviceName}
            onChange={(event) => setServiceName(event.target.value)}
          />
        </FormField>
        <FormField id="service-duration" label="Minutes">
          <Input
            id="service-duration"
            inputMode="numeric"
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
          />
        </FormField>
        <Button type="submit" disabled={savingService || serviceName.trim().length === 0}>
          {savingService ? 'Adding…' : 'Add service'}
        </Button>
      </form>
    </section>
  );
}
