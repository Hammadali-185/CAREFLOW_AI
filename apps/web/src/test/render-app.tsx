import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { AppProviders } from '../app/providers';
import { appRoutes } from '../app/router';

export function renderRoute(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });

  return render(
    <AppProviders config={{ apiBaseUrl: 'http://127.0.0.1:4000' }}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
}
