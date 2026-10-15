import type { Slot } from '@careflow/shared';
import { Button } from '../../components/ui/Button';
import { formatVisitTime } from '../appointments/format-visit';

export function SlotChoiceCard({
  slot,
  timeZone,
  disabled,
  onSelect,
}: {
  slot: Slot;
  timeZone: string;
  disabled: boolean;
  onSelect: (slot: Slot) => void;
}) {
  const when = formatVisitTime(slot.startsAt, timeZone);
  return (
    <Button variant="secondary" disabled={disabled} onClick={() => onSelect(slot)}>
      {when} with {slot.staffName}
    </Button>
  );
}
