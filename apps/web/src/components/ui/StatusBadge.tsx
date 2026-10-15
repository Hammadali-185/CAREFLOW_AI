import type { MembershipRole } from '@careflow/shared';
import { Badge, type BadgeTone } from './Badge';

const roles: Record<MembershipRole, { tone: BadgeTone; label: string }> = {
  owner: { tone: 'warning', label: 'Clinic administrator' },
  staff: { tone: 'success', label: 'Staff' },
  patient: { tone: 'info', label: 'Patient' },
};

export function StatusBadge({ role }: { role: MembershipRole }) {
  const status = roles[role];
  return <Badge tone={status.tone}>{status.label}</Badge>;
}
