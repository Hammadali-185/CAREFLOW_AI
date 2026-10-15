import { useEffect, useId, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { homePath, primaryNavigation } from '../../app/navigation';
import { useAuth } from '../../features/auth/auth-session';
import { cn } from '../../lib/utils';
import { BrandMark } from '../shared/BrandMark';

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const menuId = useId();
  const auth = useAuth();
  const staffDesk = auth.user?.memberships.some(
    (membership) => membership.role === 'owner' || membership.role === 'staff',
  );
  const patient = auth.user?.memberships.some((membership) => membership.role === 'patient');
  const home = homePath(auth.user?.memberships ?? []);
  const navigation =
    auth.status === 'authenticated'
      ? [
          { to: home, label: 'Home' },
          ...(patient ? [{ to: '/assistant', label: 'Assistant' }] : []),
          { to: '/book', label: 'Book a visit' },
          { to: '/visits', label: 'Your visits' },
          ...(staffDesk && home !== '/clinic' ? [{ to: '/clinic', label: 'Clinic desk' }] : []),
          { to: '/account', label: 'Your account' },
        ]
      : primaryNavigation;

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <header className="relative sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <BrandMark />
        <button
          type="button"
          className="focus-ring inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink sm:hidden"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Close menu' : 'Menu'}
        </button>
        <nav
          id={menuId}
          aria-label="Primary"
          className={cn(
            'absolute inset-x-0 top-full border-b border-line bg-paper px-4 py-3 sm:static sm:flex sm:items-center sm:gap-1 sm:border-0 sm:bg-transparent sm:p-0',
            open ? 'flex flex-col' : 'hidden sm:flex',
          )}
        >
          {navigation.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'focus-ring rounded-md px-3 py-2 text-base font-semibold text-ink-soft hover:bg-foam hover:text-ink',
                  isActive && 'bg-foam text-teal-deep',
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}
