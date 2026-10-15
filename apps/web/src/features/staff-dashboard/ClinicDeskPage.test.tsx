import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderRoute } from '../../test/render-app';
import { addCivilDays, clinicCivilDate, clinicMidnightUtc } from '../appointments/format-visit';

const clinicId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const zone = 'America/New_York';

describe('clinic desk', () => {
  beforeEach(() => {
    const today = clinicCivilDate(zone);
    const todayStart = clinicMidnightUtc(today, zone).getTime();
    const later = clinicMidnightUtc(addCivilDays(today, 2), zone).getTime();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
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
                timezone: zone,
              },
              role: 'staff',
              access: 'staff',
            },
            200,
          );
        }
        if (url.endsWith(`/api/clinics/${clinicId}/services`)) {
          return json({ services: [] }, 200);
        }
        if (url.endsWith(`/api/clinics/${clinicId}/staff-members`)) {
          return json({ staff: [{ userId, displayName: 'Hamza Qureshi', role: 'staff' }] }, 200);
        }
        if (url.includes('/schedule')) {
          return json(
            {
              staffUserId: userId,
              appointments: [
                visit(
                  '44444444-4444-4444-8444-444444444441',
                  new Date(todayStart + 15 * 60 * 60 * 1000),
                ),
                visit(
                  '44444444-4444-4444-8444-444444444442',
                  new Date(later + 15 * 60 * 60 * 1000),
                ),
              ],
            },
            200,
          );
        }
        if (url.includes('/availability')) {
          return json({ staffUserId: userId, windows: [], timeOff: [] }, 200);
        }
        return json({ error: { code: 'NOT_FOUND', message: 'Missing.' } }, 404);
      }),
    );
  });

  it('counts only today’s requested and confirmed visits', async () => {
    renderRoute('/clinic');
    expect(await screen.findByRole('heading', { name: 'Clinic desk' })).toBeVisible();
    const main = within(screen.getByRole('main'));
    const today = main.getByRole('region', { name: 'Today' });
    expect(await within(today).findByText('1')).toBeVisible();
    expect(await main.findAllByRole('heading', { name: 'Follow-up visit' })).toHaveLength(1);
  });
});

function visit(id: string, starts: Date) {
  return {
    id,
    clinicId,
    clinicName: 'Harbor Light Family Clinic',
    serviceId: '33333333-3333-4333-8333-333333333332',
    serviceName: 'Follow-up visit',
    durationMinutes: 20,
    staffUserId: userId,
    staffName: 'Hamza Qureshi',
    status: 'confirmed',
    startsAt: starts.toISOString(),
    endsAt: new Date(starts.getTime() + 20 * 60 * 1000).toISOString(),
    cancelledAt: null,
  };
}

function session() {
  return {
    user: {
      id: userId,
      email: 'hamza.qureshi@harbor-light.example',
      displayName: 'Hamza Qureshi',
      memberships: [
        {
          businessId: clinicId,
          businessName: 'Harbor Light Family Clinic',
          businessSlug: 'harbor-light',
          role: 'staff',
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
