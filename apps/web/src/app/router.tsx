import type { RouteObject } from 'react-router';
import { createBrowserRouter } from 'react-router';
import { AccountPage } from '../features/auth/AccountPage';
import { LoginPage } from '../features/auth/LoginPage';
import { RegisterPage } from '../features/auth/RegisterPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { AssistantPage } from '../features/chat/AssistantPage';
import { BookPage } from '../features/appointments/BookPage';
import { ClinicDeskPage } from '../features/staff-dashboard/ClinicDeskPage';
import { VisitsPage } from '../features/appointments/VisitsPage';
import { PatientDashboardPage } from '../features/patient-dashboard/PatientDashboardPage';
import { LandingPage } from '../features/landing/LandingPage';
import { NotFoundPage } from './not-found-page';
import { RootLayout } from './root-layout';

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    Component: RootLayout,
    children: [
      { index: true, Component: LandingPage },
      { path: 'login', Component: LoginPage },
      { path: 'register', Component: RegisterPage },
      {
        Component: RequireAuth,
        children: [
          { path: 'dashboard', Component: PatientDashboardPage },
          { path: 'account', Component: AccountPage },
          { path: 'assistant', Component: AssistantPage },
          { path: 'book', Component: BookPage },
          { path: 'visits', Component: VisitsPage },
          { path: 'clinic', Component: ClinicDeskPage },
        ],
      },
      { path: '*', Component: NotFoundPage },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
