import type { AppointmentStatus } from '@careflow/shared';
import { FormField } from '../../components/ui/FormField';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { appointmentStatusLabel } from './format-visit';
import type { StatusFilter } from './appointment-filters';

const statuses: AppointmentStatus[] = [
  'requested',
  'confirmed',
  'cancelled',
  'completed',
  'no_show',
];

export function AppointmentToolbar({
  query,
  status,
  onQuery,
  onStatus,
}: {
  query: string;
  status: StatusFilter;
  onQuery: (value: string) => void;
  onStatus: (value: StatusFilter) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
      <FormField id="visit-search" label="Search">
        <Input
          id="visit-search"
          value={query}
          placeholder="Service, staff, or clinic"
          onChange={(event) => onQuery(event.target.value)}
        />
      </FormField>
      <FormField id="visit-status" label="Status">
        <Select
          id="visit-status"
          value={status}
          onChange={(event) => onStatus(event.target.value as StatusFilter)}
        >
          <option value="all">Any status</option>
          {statuses.map((item) => (
            <option key={item} value={item}>
              {appointmentStatusLabel(item)}
            </option>
          ))}
        </Select>
      </FormField>
    </div>
  );
}
