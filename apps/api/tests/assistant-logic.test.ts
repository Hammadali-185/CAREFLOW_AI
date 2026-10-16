import { describe, expect, it, vi } from 'vitest';
import { looksLikeEmergency } from '../src/modules/assistant/emergency.js';
import { looksLikeGreeting } from '../src/modules/assistant/greeting.js';
import { screenedIntent } from '../src/modules/assistant/screen.js';
import { createMistralClient } from '../src/modules/assistant/mistral.js';
import { ModelRequestError } from '../src/modules/assistant/model.js';
import { parseModelIntent } from '../src/modules/assistant/parse-intent.js';
import {
  filterSlots,
  resolveDatePreference,
  resolveService,
} from '../src/modules/assistant/resolve.js';
import { applyExtraction, emptyWorkflow } from '../src/modules/assistant/workflow.js';
import type { ModelIntent } from '@careflow/shared';

const today = '2026-10-14';

describe('scheduling intent', () => {
  it('asks rather than guessing an ambiguous weekday', () => {
    const resolved = resolveDatePreference('Tuesday or Thursday', today);
    expect(resolved.status).toBe('ambiguous');
  });

  it('rejects a calendar day that does not exist', () => {
    expect(resolveDatePreference('2026-02-31', today).status).toBe('invalid');
  });

  it('keeps a service when a later message only changes the day', () => {
    const first = applyExtraction(
      emptyWorkflow(),
      intent({
        intent: 'book',
        serviceQuery: 'Follow-up',
        datePreference: 'tomorrow',
      }),
    );
    const next = applyExtraction(
      first.state,
      intent({
        intent: 'clarify',
        serviceQuery: null,
        datePreference: 'Friday',
      }),
    );
    expect(next.state.intent).toBe('book');
    expect(next.state.serviceQuery).toBe('Follow-up');
    expect(next.state.datePreference).toBe('Friday');
    expect(next.preferenceChanged).toBe(true);
    expect(next.state.selectedSlot).toBeNull();
  });

  it('does not treat a nonexistent service as a match', () => {
    const result = resolveService('massage', [
      { id: '33333333-3333-4333-8333-333333333332', name: 'Follow-up visit', active: true },
    ]);
    expect(result.status).toBe('none');
  });

  it('rejects model output that is not the intent schema', () => {
    expect(parseModelIntent('DROP TABLE appointments;').ok).toBe(false);
    expect(
      parseModelIntent(
        JSON.stringify({
          ...intent({ intent: 'book', serviceQuery: 'Follow-up' }),
          sql: 'delete from appointments',
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseModelIntent(JSON.stringify({ ...intent({ intent: 'book' }), booked: true })).ok,
    ).toBe(false);
  });

  it('does not invent a slot when the preferred time has no match', () => {
    const filtered = filterSlots(
      [
        {
          staffUserId: '22222222-2222-4222-8222-222222222222',
          staffName: 'Hamza Qureshi',
          startsAt: '2026-10-15T17:00:00.000Z',
          endsAt: '2026-10-15T17:20:00.000Z',
        },
      ],
      '7:00 AM',
      'America/New_York',
    );
    expect(filtered.slots[0]?.startsAt).toBe('2026-10-15T17:00:00.000Z');
    expect(filtered.relaxed).toBe(true);
  });

  it('treats emergency wording as an emergency before any booking', () => {
    expect(looksLikeEmergency('I have chest pain and need help')).toBe(true);
    expect(looksLikeEmergency('I need a follow-up tomorrow')).toBe(false);
    expect(looksLikeGreeting('hi')).toBe(true);
    expect(looksLikeGreeting('Hi, how are you?')).toBe(true);
    expect(looksLikeGreeting('I need a follow-up next Thursday')).toBe(false);
    expect(screenedIntent('Follow-up visit', ['Follow-up visit', 'Annual physical'])).toMatchObject(
      { intent: 'book', serviceQuery: 'Follow-up visit' },
    );
    expect(screenedIntent('Tomorrow', ['Follow-up visit'])).toMatchObject({
      datePreference: 'tomorrow',
    });
    expect(screenedIntent('I need a follow-up next Thursday', ['Follow-up visit'])).toBeNull();
  });
});

describe('Mistral client', () => {
  it('fails closed when the API key is missing', async () => {
    const client = createMistralClient({
      apiKey: undefined,
      model: 'mistral-small-latest',
      timeoutMs: 1000,
    });
    await expect(client.complete({ system: 'test', messages: [] })).rejects.toMatchObject({
      code: 'MISSING_API_KEY',
    });
  });

  it('maps a provider rate limit and a timeout without returning the prompt', async () => {
    const limited = createMistralClient({
      apiKey: 'test-key',
      model: 'mistral-small-latest',
      timeoutMs: 1000,
      fetchImpl: vi.fn(async () => new Response('slow down', { status: 429 })),
    });
    await expect(
      limited.complete({ system: 'secret prompt', messages: [] }),
    ).rejects.toBeInstanceOf(ModelRequestError);

    const timedOut = createMistralClient({
      apiKey: 'test-key',
      model: 'mistral-small-latest',
      timeoutMs: 1000,
      fetchImpl: vi.fn(async () => {
        const error = new Error('timed out');
        error.name = 'TimeoutError';
        throw error;
      }),
    });
    try {
      await timedOut.complete({
        system: 'secret prompt',
        messages: [{ role: 'user', content: 'chest pain details' }],
      });
      throw new Error('expected a timeout');
    } catch (error) {
      expect(error).toBeInstanceOf(ModelRequestError);
      expect(error instanceof ModelRequestError ? error.code : '').toBe('TIMEOUT');
      expect(error instanceof Error ? error.message : '').not.toContain('chest pain');
      expect(error instanceof Error ? error.message : '').not.toContain('secret prompt');
    }
  });
});

function intent(overrides: Partial<ModelIntent>): ModelIntent {
  return {
    intent: 'clarify',
    serviceQuery: null,
    datePreference: null,
    timePreference: null,
    staffQuery: null,
    missingFields: [],
    needsClarification: false,
    clarificationQuestion: null,
    proposedAction: 'ask',
    confirmationState: 'not_required',
    emergency: false,
    ...overrides,
  };
}
