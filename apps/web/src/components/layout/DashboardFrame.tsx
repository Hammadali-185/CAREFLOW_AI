import type { PublicUser } from '@careflow/shared';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';
import { dashboardNavigation, homePath } from '../../app/navigation';
import { cn } from '../../lib/utils';
import { BrandMark } from '../shared/BrandMark';
import { SiteFooter } from './SiteFooter';

export function DashboardFrame({ user, children }: { user: PublicUser; children: ReactNode }) {
  const items = dashboardNavigation(user.memberships);
  const home = homePath(user.memberships);
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const menuId = useId();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.scrollPaddingTop = '6rem';
    root.style.scrollPaddingBottom = '7rem';
    return () => {
      root.style.scrollPaddingTop = '';
      root.style.scrollPaddingBottom = '';
    };
  }, []);

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
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <div className="h-1 bg-teal lg:fixed lg:inset-y-0 lg:left-0 lg:h-auto lg:w-1" />
      <a
        href="#main"
        className="focus-ring sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-40 focus:rounded-md focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur-md lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <BrandMark to={home} />
          <button
            type="button"
            className="focus-ring inline-flex min-h-11 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? 'Close menu' : 'Menu'}
          </button>
        </div>
      </header>
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-white lg:flex">
        <div className="px-4 py-5">
          <BrandMark to={home} />
        </div>
        <Navigation items={items} className="flex flex-1 flex-col gap-1 px-3 pb-6" />
      </aside>
      {open ? (
        <div className="fixed inset-0 z-30 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-ink/40"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <nav
            id={menuId}
            aria-label="Primary"
            className="absolute inset-y-0 left-0 flex w-[min(18rem,calc(100vw-3rem))] flex-col gap-1 overflow-y-auto bg-white p-4 shadow-card"
          >
            <p className="px-3 pb-2 text-sm font-semibold text-ink">{user.displayName}</p>
            <Navigation items={items} className="flex flex-col gap-1" />
          </nav>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <main id="main" className="min-w-0 flex-1 scroll-pb-28 pb-28 lg:scroll-pb-0 lg:pb-0">
          {children}
        </main>
        <div className="hidden lg:block">
          <SiteFooter />
        </div>
      </div>
      <nav
        aria-label="Shortcuts"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white lg:hidden"
      >
        <ul className="flex overflow-x-auto">
          {items.map((item) => (
            <li key={item.to} className="min-w-[4.5rem] flex-1">
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'focus-ring flex min-h-14 items-center justify-center px-2 text-center text-xs font-semibold text-ink-soft',
                    isActive && 'text-teal-deep',
                  )
                }
              >
                {item.shortLabel ?? item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

function Navigation({
  items,
  className,
}: {
  items: ReturnType<typeof dashboardNavigation>;
  className: string;
}) {
  return (
    <nav aria-label="Primary" className={className}>
      {items.map((item) => (
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
  );
}
