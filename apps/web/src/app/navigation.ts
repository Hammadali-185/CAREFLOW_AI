import type { PublicUser } from '@careflow/shared';
import type { NavItem } from '../types/navigation';

type Membership = PublicUser['memberships'][number];

export const primaryNavigation: NavItem[] = [
  { to: '/login', label: 'Sign in' },
  { to: '/register', label: 'Create account' },
];

export function homePath(memberships: readonly Membership[]) {
  if (memberships.some((membership) => membership.role === 'patient')) {
    return '/dashboard';
  }
  if (
    memberships.some((membership) => membership.role === 'owner' || membership.role === 'staff')
  ) {
    return '/clinic';
  }
  return '/account';
}

export function dashboardNavigation(memberships: readonly Membership[]): NavItem[] {
  const patient = memberships.some((membership) => membership.role === 'patient');
  const staff = memberships.some(
    (membership) => membership.role === 'owner' || membership.role === 'staff',
  );
  const items: NavItem[] = [];
  if (patient) {
    items.push(
      { to: '/dashboard', label: 'Home', shortLabel: 'Home' },
      { to: '/visits', label: 'Your visits', shortLabel: 'Visits' },
      { to: '/book', label: 'Book a visit', shortLabel: 'Book' },
      { to: '/assistant', label: 'Assistant', shortLabel: 'Chat' },
    );
  }
  if (staff) {
    items.push({ to: '/clinic', label: 'Clinic desk', shortLabel: 'Desk' });
  }
  items.push({ to: '/account', label: 'Your account', shortLabel: 'You' });
  return items;
}
