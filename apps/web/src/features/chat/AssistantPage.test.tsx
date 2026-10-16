import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderRoute } from '../../test/render-app';

const clinicId = '11111111-1111-4111-8111-111111111111';
const sessionId = '55555555-5555-4555-8555-555555555551';
const serviceId = '33333333-3333-4333-8333-333333333332';
const staffId = '22222222-2222-4222-8222-222222222222';
const userId = '22222222-2222-4222-8222-222222222223';
let messageBodies: Array<{ text: string; retry?: boolean; turnKey?: string }> = [];

describe('assistant chat', () => {
  beforeEach(() => {
    messageBodies = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (url.endsWith('/api/auth/me')) {
          return json(sessionBody(), 200);
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
        if (url.endsWith(`/api/clinics/${clinicId}/assistant/sessions`) && method === 'GET') {
          return json({ sessions: [] }, 200);
        }
        if (url.endsWith(`/api/clinics/${clinicId}/assistant/sessions`) && method === 'POST') {
          return json(turn({ messages: [], outcome: 'loaded' }), 201);
        }
        if (url.endsWith(`/api/assistant/sessions/${sessionId}`) && method === 'GET') {
          return json(turn({ messages: [], outcome: 'loaded' }), 200);
        }
        if (url.endsWith(`/api/assistant/sessions/${sessionId}/messages`) && method === 'POST') {
          const body = JSON.parse(String(init?.body)) as {
            text: string;
            retry?: boolean;
            turnKey?: string;
          };
          messageBodies.push(body);
          const text = body.text;
          if (text === 'busy please') {
            if (body.retry) {
              return json(
                turn({
                  outcome: 'reply',
                  messages: [
                    message('user', text),
                    message('assistant', 'Which service should I look up? Follow-up visit.'),
                  ],
                }),
                200,
              );
            }
            return json(
              turn({
                outcome: 'unavailable',
                messages: [
                  message('user', text),
                  message(
                    'assistant',
                    'The scheduling assistant is busy. Wait a moment or use the booking form.',
                  ),
                ],
              }),
              200,
            );
          }
          if (text === 'network please') {
            if (body.retry) {
              return json(
                turn({
                  outcome: 'reply',
                  messages: [
                    message('user', text),
                    message('assistant', 'I can help you book a visit.'),
                  ],
                }),
                200,
              );
            }
            return json(
              { error: { code: 'AI_UNAVAILABLE', message: 'The assistant is down.' } },
              503,
            );
          }
          if (text === 'what should I bring') {
            return json(
              turn({
                outcome: 'reply',
                messages: [
                  message('user', text),
                  message('assistant', 'I cannot help with that request.'),
                  message(
                    'assistant',
                    'Your Follow-up visit is confirmed for Thursday at 9:00 AM with Ali Subhan at Harbor Light Family Clinic.',
                  ),
                ],
                workflow: {
                  ...emptyWorkflow(),
                  phase: 'completed',
                  intent: 'book',
                  serviceId,
                  appointmentId: '44444444-4444-4444-8444-444444444449',
                },
                appointment: {
                  id: '44444444-4444-4444-8444-444444444449',
                  clinicId,
                  clinicName: 'Harbor Light Family Clinic',
                  serviceId,
                  serviceName: 'Follow-up visit',
                  durationMinutes: 20,
                  staffUserId: staffId,
                  staffName: 'Ali Subhan',
                  status: 'confirmed',
                  startsAt: '2026-10-15T13:00:00.000Z',
                  endsAt: '2026-10-15T13:20:00.000Z',
                  cancelledAt: null,
                },
              }),
              200,
            );
          }
          return json(
            turn({
              outcome: 'slots',
              messages: [
                message('user', text),
                message(
                  'assistant',
                  'These are open Follow-up times. Nothing is booked until you confirm.',
                ),
              ],
              workflow: {
                ...emptyWorkflow(),
                phase: 'awaiting_slot',
                intent: 'book',
                serviceId,
                date: '2026-10-15',
                confirmationState: 'required',
                offeredSlots: [
                  {
                    staffUserId: staffId,
                    staffName: 'Ali Subhan',
                    startsAt: '2026-10-15T13:00:00.000Z',
                    endsAt: '2026-10-15T13:20:00.000Z',
                  },
                ],
              },
            }),
            200,
          );
        }
        if (url.endsWith(`/api/assistant/sessions/${sessionId}/slots`) && method === 'POST') {
          return json(
            turn({
              outcome: 'review',
              appointment: null,
              messages: [
                message(
                  'assistant',
                  'Book Follow-up at Harbor Light. This is not saved until you confirm.',
                ),
              ],
              workflow: {
                ...emptyWorkflow(),
                phase: 'awaiting_confirmation',
                confirmationState: 'required',
              },
            }),
            200,
          );
        }
        if (url.endsWith(`/api/assistant/sessions/${sessionId}/confirm`) && method === 'POST') {
          return json(
            turn({
              outcome: 'booked',
              appointment: {
                id: '44444444-4444-4444-8444-444444444449',
                clinicId,
                clinicName: 'Harbor Light Family Clinic',
                serviceId,
                serviceName: 'Follow-up visit',
                durationMinutes: 20,
                staffUserId: staffId,
                staffName: 'Ali Subhan',
                status: 'confirmed',
                startsAt: '2026-10-15T13:00:00.000Z',
                endsAt: '2026-10-15T13:20:00.000Z',
                cancelledAt: null,
              },
            }),
            200,
          );
        }
        return json({ error: { code: 'NOT_FOUND', message: 'Missing.' } }, 404);
      }),
    );
  });

  it('shows a booked visit only after the server returns the saved appointment', async () => {
    const user = userEvent.setup();
    renderRoute('/assistant');

    await user.click(await screen.findByRole('button', { name: 'New' }));
    await user.type(await screen.findByLabelText('Message'), 'Follow-up tomorrow morning');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(
      await screen.findByText(
        'These are open Follow-up times. Nothing is booked until you confirm.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Your visit is booked' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /ali subhan/i }));
    expect(await screen.findByRole('heading', { name: 'Review this visit' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Your visit is booked' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirm visit' }));
    expect(await screen.findByRole('heading', { name: 'Your visit is booked' })).toBeVisible();
  });

  it('retries a saved message once when the assistant is temporarily unavailable', async () => {
    const user = userEvent.setup();
    renderRoute('/assistant');
    await user.click(await screen.findByRole('button', { name: 'New' }));
    await user.type(await screen.findByLabelText('Message'), 'busy please');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect((await screen.findAllByText(/scheduling assistant is busy/i)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Your visit is booked' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Use the booking form' })[0]).toHaveAttribute(
      'href',
      '/book',
    );

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(/which service should I look up/i)).toBeVisible();
    expect(messageBodies[0]?.turnKey).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
    expect(messageBodies[1]).toEqual({
      text: 'busy please',
      retry: true,
      turnKey: messageBodies[0]?.turnKey,
    });
  });

  it('keeps the saved-visit heading after a later reply that still has the completed visit', async () => {
    const user = userEvent.setup();
    renderRoute('/assistant');

    await user.click(await screen.findByRole('button', { name: 'New' }));
    await user.type(await screen.findByLabelText('Message'), 'Follow-up tomorrow morning');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await user.click(await screen.findByRole('button', { name: /ali subhan/i }));
    await user.click(await screen.findByRole('button', { name: 'Confirm visit' }));
    expect(await screen.findByRole('heading', { name: 'Your visit is booked' })).toBeVisible();

    await user.type(screen.getByLabelText('Message'), 'what should I bring');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/cannot help with that request/i)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Your visit is booked' })).toBeVisible();
  });

  it('keeps the typed message when sending fails', async () => {
    const user = userEvent.setup();
    renderRoute('/assistant');
    await user.click(await screen.findByRole('button', { name: 'New' }));
    const field = await screen.findByLabelText('Message');
    await user.type(field, 'network please');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByText('The assistant is down.')).toBeVisible();
    expect(field).toHaveValue('network please');
    expect(screen.getAllByRole('link', { name: 'Use the booking form' })[0]).toHaveAttribute(
      'href',
      '/book',
    );
    expect(screen.queryByRole('heading', { name: 'Your visit is booked' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('I can help you book a visit.')).toBeVisible();
    expect(messageBodies.at(-2)?.turnKey).toMatch(/^[A-Za-z0-9_-]{8,80}$/);
    expect(messageBodies.at(-1)).toEqual({
      text: 'network please',
      retry: true,
      turnKey: messageBodies.at(-2)?.turnKey,
    });
  });
});

function sessionBody() {
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

function message(senderKind: 'user' | 'assistant', body: string) {
  return {
    id: crypto.randomUUID(),
    senderKind,
    body,
    createdAt: '2026-10-14T15:00:00.000Z',
  };
}

function emptyWorkflow() {
  return {
    phase: 'collecting',
    intent: null,
    serviceQuery: null,
    datePreference: null,
    timePreference: null,
    staffQuery: null,
    serviceId: null,
    date: null,
    staffUserId: null,
    appointmentId: null,
    offeredSlots: [],
    selectedSlot: null,
    missingFields: [],
    confirmationState: 'not_required',
  };
}

function turn(overrides: Record<string, unknown>) {
  return {
    session: {
      id: sessionId,
      clinicId,
      clinicName: 'Harbor Light Family Clinic',
      openedAt: '2026-10-14T15:00:00.000Z',
      appointmentId: null,
      preview: null,
    },
    messages: [],
    workflow: emptyWorkflow(),
    suggestions: [],
    outcome: 'loaded',
    appointment: null,
    manualBooking: { serviceId: null, date: null },
    ...overrides,
  };
}

function json(body: unknown, status: number) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}
