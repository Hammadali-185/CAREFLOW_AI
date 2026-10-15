import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import { useAuth } from '../../features/auth/auth-session';
import { DashboardFrame } from './DashboardFrame';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

const dashboardPaths = ['/dashboard', '/account', '/assistant', '/book', '/visits', '/clinic'];

export function AppShell({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  const dashboard =
    auth.status === 'authenticated' &&
    auth.user &&
    dashboardPaths.some(
      (path) => location.pathname === path || location.pathname.startsWith(`${path}/`),
    );

  if (dashboard && auth.user) {
    return <DashboardFrame user={auth.user}>{children}</DashboardFrame>;
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="h-1 bg-teal" />
      <a
        href="#main"
        className="focus-ring sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-30 focus:rounded-md focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="min-w-0 flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
