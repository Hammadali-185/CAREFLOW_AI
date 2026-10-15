import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderRoute } from '../../test/render-app';

const clinicId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222223';

describe('patient dashboard', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/auth/me')) {
          return json(session(), 200);
        }
        if (url.endsWith('/api/appointments')) {
          return json({ appointments: [] }, 200);
        }
        return json({ error: { code: 'NOT_FOUND', message: 'Missing.' } }, 404);
      }),
    );
  });

  it('welcomes the patient and offers the form when there are no visits', async () => {
    renderRoute('/dashboard');
    expect(await screen.findByRole('heading', { name: 'Hello, Fatima Noor' })).toBeVisible();
    const main = within(screen.getByRole('main'));
    expect(main.getAllByRole('link', { name: 'Book appointment' })[0]).toHaveAttribute(
      'href',
      '/book',
    );
    expect(main.getByRole('link', { name: 'Ask the assistant' })).toHaveAttribute(
      'href',
      '/assistant',
    );
    expect(await main.findByRole('heading', { name: 'No visits yet' })).toBeVisible();
    expect(main.queryByText('Your visit is booked')).not.toBeInTheDocument();
  });
});

function session() {
  return {
    user: {
      id: userId,
      email: 'fatima.noor@patient.example',
      displayName: 'Fatima Noor',
      memberships: [
        {
          businessId: clinicId,
          businessName: 'Harbor Light Family Clinic',
          businessSlug: 'harbor-light',
          role: 'patient',
        },
      ],
    },
    csrfToken: 'csrf-token',
  };
}

function json(body: unknown, status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}
