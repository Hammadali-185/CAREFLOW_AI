import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderRoute } from '../../test/render-app';

const clinicId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222223';
const visitId = '44444444-4444-4444-8444-444444444441';

describe('visit filters', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/auth/me')) {
          return json(session(), 200);
        }
        if (url.endsWith(`/api/clinics/${clinicId}`)) {
          return json(
            {
              clinic: {
                id: clinicId,
                name: 'Harbor Light Family Clinic',
                slug: 'harbor-light',
                timezone: 'America/New_York',
              },
              role: 'patient',
              access: 'member',
            },
            200,
          );
        }
        if (url.endsWith('/api/appointments')) {
          return json(
            {
              appointments: [
                {
                  id: visitId,
                  clinicId,
                  clinicName: 'Harbor Light Family Clinic',
                  serviceId: '33333333-3333-4333-8333-333333333332',
                  serviceName: 'Follow-up visit',
                  durationMinutes: 20,
                  staffUserId: '22222222-2222-4222-8222-222222222222',
                  staffName: 'Hamza Qureshi',
                  status: 'confirmed',
                  startsAt: '2026-12-01T15:00:00.000Z',
                  endsAt: '2026-12-01T15:20:00.000Z',
                  cancelledAt: null,
                  patientContactName: 'Fatima Noor',
                  patientPhone: '555-010-2345',
                },
              ],
            },
            200,
          );
        }
        if (url.endsWith(`/api/appointments/${visitId}/cancel`)) {
          return json(
            { error: { code: 'NOT_ELIGIBLE', message: 'That visit can no longer be changed.' } },
            409,
          );
        }
        return json({ error: { code: 'NOT_FOUND', message: 'Missing.' } }, 404, init);
      }),
    );
  });

  it('keeps the visit when search misses and when cancellation is refused', async () => {
    const user = userEvent.setup();
    renderRoute('/visits');
    expect(await screen.findByRole('heading', { name: 'Follow-up visit' })).toBeVisible();
    const main = within(screen.getByRole('main'));

    await user.type(main.getByLabelText('Search'), 'massage');
    expect(await main.findByRole('heading', { name: 'No matching visits' })).toBeVisible();
    expect(main.queryByRole('heading', { name: 'Follow-up visit' })).not.toBeInTheDocument();

    await user.clear(main.getByLabelText('Search'));
    expect(await main.findByRole('heading', { name: 'Follow-up visit' })).toBeVisible();
    await user.click(main.getByRole('button', { name: 'Cancel visit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Cancel this visit?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel visit' }));
    expect(await main.findByText('That visit can no longer be changed.')).toBeVisible();
    expect(main.getByRole('heading', { name: 'Follow-up visit' })).toBeVisible();
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

function json(body: unknown, status: number, _init?: RequestInit) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}
