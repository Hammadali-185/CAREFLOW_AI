import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderRoute } from '../../test/render-app';

const clinicId = '11111111-1111-4111-8111-111111111111';
const serviceId = '22222222-2222-4222-8222-222222222222';
const staffId = '33333333-3333-4333-8333-333333333333';
const userId = '44444444-4444-4444-8444-444444444444';

describe('booking confirmation', () => {
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
        if (url.endsWith(`/api/clinics/${clinicId}/services`)) {
          return json(
            {
              services: [{ id: serviceId, name: 'Follow-up', durationMinutes: 20, active: true }],
            },
            200,
          );
        }
        if (url.endsWith(`/api/clinics/${clinicId}/staff-members`)) {
          return json(
            { staff: [{ userId: staffId, displayName: 'Hamza Qureshi', role: 'staff' }] },
            200,
          );
        }
        if (url.includes('/slots')) {
          return json(
            {
              date: '2026-10-20',
              timezone: 'America/New_York',
              closed: false,
              slots: [
                {
                  staffUserId: staffId,
                  staffName: 'Hamza Qureshi',
                  startsAt: '2026-10-20T15:00:00.000Z',
                  endsAt: '2026-10-20T15:20:00.000Z',
                },
              ],
            },
            200,
          );
        }
        if (url.endsWith('/appointments') && init?.method === 'POST') {
          const headers = new Headers(init.headers);
          expect(headers.get('Idempotency-Key')).toMatch(/^[a-f0-9]{32}$/);
          expect(headers.get('X-CSRF-Token')).toBe('csrf-token');
          return json(
            {
              error: {
                code: 'SLOT_TAKEN',
                message: 'That time was just booked. Choose another.',
              },
            },
            409,
          );
        }
        return json({ error: { code: 'NOT_FOUND', message: 'Missing.' } }, 404);
      }),
    );
  });

  it('keeps the selected time when confirmation is rejected', async () => {
    const user = userEvent.setup();
    renderRoute('/book');

    expect(await screen.findByRole('heading', { name: 'Book a visit' })).toBeVisible();
    await user.selectOptions(await screen.findByLabelText('Service'), serviceId);
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-20' } });
    await user.click(await screen.findByRole('button', { name: /hamza qureshi/i }));
    await user.type(screen.getByLabelText('Phone number'), '555-010-2345');
    await user.click(screen.getByRole('button', { name: 'Review booking' }));
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }));

    expect(await screen.findByText('That time was just booked. Choose another.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Review' })).toBeVisible();
    expect(screen.getByLabelText('Service')).toHaveValue(serviceId);
    expect(screen.getByLabelText('Date')).toHaveValue('2026-10-20');
    expect(screen.queryByText('Your visit is booked')).not.toBeInTheDocument();
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
