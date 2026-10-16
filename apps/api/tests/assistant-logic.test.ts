import { describe, expect, it, vi } from 'vitest';
import { looksLikeEmergency } from '../src/modules/assistant/emergency.js';
import { looksLikeGreeting } from '../src/modules/assistant/greeting.js';
import { groundMessage } from '../src/modules/assistant/ground.js';
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
    const { topic: _topic, ...withoutTopic } = intent({ intent: 'clarify' });
    const omitted = parseModelIntent(JSON.stringify(withoutTopic));
    expect(omitted.ok && omitted.intent.topic).toBe(null);
    expect(
      parseModelIntent(JSON.stringify({ ...intent({ intent: 'clarify' }), topic: 'prices' })).ok,
    ).toBe(false);
    const services = parseModelIntent(
      JSON.stringify(intent({ intent: 'clarify', topic: 'services' })),
    );
    expect(services.ok && services.intent.topic).toBe('services');
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
  });
});

describe('catalog grounding', () => {
  const services = [
    { id: '33333333-3333-4333-8333-333333333332', name: 'Follow-up visit', active: true },
    { id: '33333333-3333-4333-8333-333333333331', name: 'New patient visit', active: true },
  ];
  const staff = [{ userId: '22222222-2222-4222-8222-222222222222', displayName: 'Hamza Qureshi' }];

  it('uses the catalog record for an exact service selection and ignores a sentence', () => {
    const selected = groundMessage({
      text: 'Follow-up visit',
      workflow: emptyWorkflow(),
      services,
      staff,
      today,
    });
    expect(selected?.serviceQuery).toBe('Follow-up visit');
    expect(selected?.intent).toBe('book');
    expect(
      groundMessage({
        text: 'What is a follow-up visit?',
        workflow: emptyWorkflow(),
        services,
        staff,
        today,
      }),
    ).toBeNull();
  });

  it('keeps the current visit when the whole message is a date the scheduler understands', () => {
    const workflow = {
      ...emptyWorkflow(),
      intent: 'book' as const,
      serviceQuery: 'Follow-up visit',
      missingFields: ['date' as const],
    };
    const selected = groundMessage({
      text: 'Tomorrow',
      workflow,
      services,
      staff,
      today,
    });
    expect(selected?.intent).toBe('book');
    expect(selected?.datePreference).toBe('Tomorrow');
    expect(selected?.serviceQuery).toBeNull();
    expect(
      groundMessage({
        text: 'book me tomorrow',
        workflow,
        services,
        staff,
        today,
      }),
    ).toBeNull();
    expect(
      groundMessage({
        text: 'Make it Friday instead',
        workflow,
        services,
        staff,
        today,
      }),
    ).toBeNull();
  });
});

describe('Mistral client', () => {
  it('fails closed when the API key is missing', async () => {
    const fetchImpl = vi.fn();
    const client = createMistralClient({
      apiKey: undefined,
      model: 'mistral-small-latest',
      timeoutMs: 1000,
      fetchImpl,
    });
    await expect(client.complete({ system: 'test', messages: [] })).rejects.toMatchObject({
      code: 'MISSING_API_KEY',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('retries a rate limit inside the delay budget and stops when Retry-After is too long', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const limited = createMistralClient({
      apiKey: 'test-key',
      model: 'mistral-small-latest',
      timeoutMs: 5000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      now: () => 0,
      random: () => 0,
      fetchImpl: vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          return new Response('slow down', { status: 429 });
        }
        return completionResponse();
      }),
    });
    const completed = await limited.complete({ system: 'secret prompt', messages: [] });
    expect(completed.content).toContain('ok');
    expect(calls).toBe(2);
    expect(sleeps[0]).toBeLessThanOrEqual(1000);

    const held = vi.fn(
      async () => new Response('slow down', { status: 429, headers: { 'retry-after': '30' } }),
    );
    const blocked = createMistralClient({
      apiKey: 'test-key',
      model: 'mistral-small-latest',
      timeoutMs: 5000,
      sleep: async () => {},
      now: () => 0,
      fetchImpl: held,
    });
    await expect(blocked.complete({ system: 'secret prompt', messages: [] })).rejects.toMatchObject(
      {
        code: 'RATE_LIMITED',
        providerStatus: 429,
      },
    );
    expect(held).toHaveBeenCalledTimes(1);
  });

  it('does not retry provider authentication and does not reveal the key or prompt', async () => {
    const fetchImpl = vi.fn(async () => new Response('denied', { status: 401 }));
    const client = createMistralClient({
      apiKey: 'test-key',
      model: 'mistral-small-latest',
      timeoutMs: 1000,
      fetchImpl,
    });
    try {
      await client.complete({
        system: 'secret prompt',
        messages: [{ role: 'user', content: 'chest pain details' }],
      });
      throw new Error('expected provider auth to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ModelRequestError);
      expect(error instanceof ModelRequestError ? error.code : '').toBe('PROVIDER_AUTH');
      expect(error instanceof ModelRequestError ? error.providerStatus : 0).toBe(401);
      expect(error instanceof Error ? error.message : '').not.toContain('test-key');
      expect(error instanceof Error ? error.message : '').not.toContain('chest pain');
      expect(error instanceof Error ? error.message : '').not.toContain('secret prompt');
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a server error and a fast timeout, and stops when the timeout budget is gone', async () => {
    let calls = 0;
    const recovered = createMistralClient({
      apiKey: 'test-key',
      model: 'mistral-small-latest',
      timeoutMs: 5000,
      sleep: async () => {},
      now: () => 0,
      random: () => 0,
      fetchImpl: vi.fn(async () => {
        calls += 1;
        if (calls < 3) {
          return new Response('down', { status: 503 });
        }
        return completionResponse();
      }),
    });
    await expect(
      recovered.complete({ system: 'secret prompt', messages: [] }),
    ).resolves.toMatchObject({
      content: expect.stringContaining('ok'),
    });
    expect(calls).toBe(3);

    let clock = 0;
    const exhausted = vi.fn(async () => {
      clock += 1000;
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    });
    const timedOut = createMistralClient({
      apiKey: 'test-key',
      model: 'mistral-small-latest',
      timeoutMs: 1000,
      sleep: async () => {},
      now: () => clock,
      fetchImpl: exhausted,
    });
    await expect(
      timedOut.complete({
        system: 'secret prompt',
        messages: [{ role: 'user', content: 'chest pain details' }],
      }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(exhausted).toHaveBeenCalledTimes(1);
  });
});

function completionResponse() {
  return new Response(
    JSON.stringify({
      model: 'test-model',
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
    { status: 200 },
  );
}

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
    topic: null,
    ...overrides,
  };
}
