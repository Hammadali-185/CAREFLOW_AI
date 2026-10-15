import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderRoute } from '../../test/render-app';

describe('LandingPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/auth/me')) {
          return jsonResponse(
            { error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' } },
            401,
          );
        }
        if (url.endsWith('/api/ready') || url.endsWith('/api/health/ready')) {
          return jsonResponse(
            {
              status: 'unavailable',
              database: 'down',
              timestamp: '2026-10-14T12:00:00.000Z',
            },
            503,
          );
        }

        return jsonResponse(
          {
            status: 'ok',
            service: 'careflow-api',
            timestamp: '2026-10-14T12:00:00.000Z',
          },
          200,
        );
      }),
    );
  });

  it('links to the account pages and shows a live API check', async () => {
    renderRoute('/');

    const main = within(screen.getByRole('main'));
    expect(main.getByRole('heading', { name: /calmer front desk/i })).toBeVisible();
    expect(main.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
    expect(main.getByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/register');
    expect(await screen.findByText('API up')).toBeVisible();
    expect(await screen.findByText('Database down')).toBeVisible();
    expect(screen.getByText(/waits for you to confirm/i)).toBeVisible();
  });
});

function jsonResponse(body: unknown, status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}
