import type { ServiceRecord, Slot, StaffMember } from '@careflow/shared';
import { useQuery } from '@tanstack/react-query';
import { Alert } from '../../components/feedback/Alert';
import { LoadingSkeleton } from '../../components/feedback/LoadingSkeleton';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { useApiClient } from '../../hooks/use-api';
import { ApiError } from '../../lib/api-client';
import { cn } from '../../lib/utils';
import { addCivilDays, clinicCivilDate, formatVisitTime } from './format-visit';

export type VisitDraft = {
  serviceId: string;
  date: string;
  staffUserId: string;
  slot: Slot | null;
};

export function VisitPlanner({
  clinicId,
  timeZone,
  services,
  staff,
  draft,
  onChange,
  lockService = false,
}: {
  clinicId: string;
  timeZone: string;
  services: ServiceRecord[];
  staff: StaffMember[];
  draft: VisitDraft;
  onChange: (draft: VisitDraft) => void;
  lockService?: boolean;
}) {
  const api = useApiClient();
  const activeServices = services.filter((service) => service.active);
  const slots = useQuery({
    queryKey: ['slots', clinicId, draft.serviceId, draft.date, draft.staffUserId],
    enabled: Boolean(draft.serviceId && draft.date),
    queryFn: ({ signal }) =>
      api.searchSlots(
        clinicId,
        {
          serviceId: draft.serviceId,
          date: draft.date,
          staffUserId: draft.staffUserId || undefined,
        },
        signal,
      ),
  });

  const today = clinicCivilDate(timeZone);
  const lastDay = addCivilDays(today, 60);

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <FormField
        id="service"
        label="Service"
        hint="Choose the visit you need. This form works on its own."
      >
        <Select
          id="service"
          value={draft.serviceId}
          disabled={lockService}
          onChange={(event) => onChange({ ...draft, serviceId: event.target.value, slot: null })}
        >
          <option value="">Select a service</option>
          {activeServices.map((service) => (
            <option key={service.id} value={service.id}>
              {service.name} ({service.durationMinutes} min)
            </option>
          ))}
        </Select>
      </FormField>
      <FormField id="visit-date" label="Date" hint="Times use the clinic's local calendar.">
        <Input
          id="visit-date"
          type="date"
          min={today}
          max={lastDay}
          value={draft.date}
          onChange={(event) => onChange({ ...draft, date: event.target.value, slot: null })}
        />
      </FormField>
      <FormField
        id="staff-member"
        label="Staff member"
        hint="Leave this as anyone to see every open time."
      >
        <Select
          id="staff-member"
          value={draft.staffUserId}
          onChange={(event) => onChange({ ...draft, staffUserId: event.target.value, slot: null })}
        >
          <option value="">Anyone available</option>
          {staff.map((person) => (
            <option key={person.userId} value={person.userId}>
              {person.displayName}
            </option>
          ))}
        </Select>
      </FormField>
      <div>
        <p className="text-sm font-semibold text-ink">Open times</p>
        <SlotResults
          timeZone={timeZone}
          loading={slots.isFetching}
          error={slots.error}
          closed={slots.data?.closed ?? false}
          slots={slots.data?.slots ?? []}
          selected={draft.slot}
          onSelect={(slot) => onChange({ ...draft, slot })}
        />
      </div>
    </form>
  );
}

function SlotResults({
  timeZone,
  loading,
  error,
  closed,
  slots,
  selected,
  onSelect,
}: {
  timeZone: string;
  loading: boolean;
  error: unknown;
  closed: boolean;
  slots: Slot[];
  selected: Slot | null;
  onSelect: (slot: Slot) => void;
}) {
  if (!loading && error) {
    return (
      <div className="mt-3">
        <Alert tone="danger" title="Those times could not be loaded">
          {error instanceof ApiError
            ? error.message
            : 'The clinic schedule did not respond. Your selections are still here.'}
        </Alert>
      </div>
    );
  }
  if (loading && slots.length === 0) {
    return (
      <div className="mt-3">
        <LoadingSkeleton label="Loading open times" />
      </div>
    );
  }
  if (closed) {
    return (
      <p className="mt-3 text-sm leading-6 text-ink-soft">
        The clinic schedule is closed that day.
      </p>
    );
  }
  if (slots.length === 0) {
    return <p className="mt-3 text-sm leading-6 text-ink-soft">No open times match that choice.</p>;
  }
  return (
    <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Open times">
      {slots.map((slot) => {
        const selectedSlot =
          selected?.startsAt === slot.startsAt && selected.staffUserId === slot.staffUserId;
        return (
          <button
            key={`${slot.staffUserId}-${slot.startsAt}`}
            type="button"
            aria-pressed={selectedSlot}
            className={cn(
              'focus-ring min-h-11 rounded-md border px-3 text-left text-sm font-semibold',
              selectedSlot
                ? 'border-teal bg-foam text-teal-deep'
                : 'border-line bg-white text-ink hover:bg-foam',
            )}
            onClick={() => onSelect(slot)}
          >
            {formatVisitTime(slot.startsAt, timeZone)}
            <span className="mt-0.5 block font-normal text-ink-soft">{slot.staffName}</span>
          </button>
        );
      })}
    </div>
  );
}
