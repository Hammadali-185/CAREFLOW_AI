import { ModelRequestError, type ModelClient, type ModelMessage } from './model.js';

const endpoint = 'https://api.mistral.ai/v1/chat/completions';
const MAX_ATTEMPTS = 3;
const MAX_DELAY_MS = 1000;
const MIN_REMAINING_MS = 200;

const missingKeyMessage = 'The scheduling assistant is not configured. You can book from the form.';
const timeoutMessage = 'The scheduling assistant took too long. You can book from the form.';
const rateLimitMessage = 'The scheduling assistant is busy. Wait a moment or use the booking form.';
const unavailableMessage = 'The scheduling assistant is unavailable. You can book from the form.';

export function createMistralClient(options: {
  apiKey: string | undefined;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}): ModelClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;

  return {
    async complete(input) {
      if (!options.apiKey) {
        throw new ModelRequestError('MISSING_API_KEY', missingKeyMessage, null);
      }

      const started = now();
      const deadline = started + options.timeoutMs;
      let lastError: ModelRequestError | null = null;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const remaining = deadline - now();
        if (attempt > 1 && remaining < MIN_REMAINING_MS) {
          break;
        }

        try {
          const response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              model: options.model,
              temperature: 0,
              response_format: { type: 'json_object' },
              messages: [
                { role: 'system', content: input.system },
                ...input.messages.map((message: ModelMessage) => ({
                  role: message.role,
                  content: message.content,
                })),
              ],
            }),
            signal: AbortSignal.timeout(Math.max(1, Math.min(options.timeoutMs, remaining))),
          });

          if (response.ok) {
            return await readSuccessful(response, options.model, now() - started);
          }

          const failure = failureForStatus(response.status);
          if (!failure.retry || attempt === MAX_ATTEMPTS) {
            throw failure.error;
          }
          const delay = delayFor(response, attempt, now, random);
          if (delay === null || now() + delay > deadline) {
            throw failure.error;
          }
          lastError = failure.error;
          await sleep(delay);
        } catch (error) {
          if (error instanceof ModelRequestError) {
            throw error;
          }
          const timedOut = isTimeout(error);
          const failure = new ModelRequestError(
            timedOut ? 'TIMEOUT' : 'UNAVAILABLE',
            timedOut ? timeoutMessage : unavailableMessage,
            null,
          );
          const delay = backoffMs(attempt, random);
          if (attempt === MAX_ATTEMPTS || now() + delay > deadline) {
            throw failure;
          }
          lastError = failure;
          await sleep(delay);
        }
      }

      throw lastError ?? new ModelRequestError('UNAVAILABLE', unavailableMessage, null);
    },
  };
}

function failureForStatus(status: number) {
  if (status === 429) {
    return {
      retry: true,
      error: new ModelRequestError('RATE_LIMITED', rateLimitMessage, status),
    };
  }
  if (status === 401 || status === 403) {
    return {
      retry: false,
      error: new ModelRequestError('PROVIDER_AUTH', unavailableMessage, status),
    };
  }
  if (status === 408 || status >= 500) {
    return {
      retry: true,
      error: new ModelRequestError('UNAVAILABLE', unavailableMessage, status),
    };
  }
  return {
    retry: false,
    error: new ModelRequestError('UNAVAILABLE', unavailableMessage, status),
  };
}

async function readSuccessful(response: Response, model: string, latencyMs: number) {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ModelRequestError('UNAVAILABLE', unavailableMessage, response.status);
  }
  const parsed = readCompletion(body);
  if (!parsed) {
    throw new ModelRequestError('UNAVAILABLE', unavailableMessage, response.status);
  }
  return {
    content: parsed.content,
    model: parsed.model || model,
    promptTokens: parsed.promptTokens,
    completionTokens: parsed.completionTokens,
    latencyMs,
  };
}

function delayFor(response: Response, attempt: number, now: () => number, random: () => number) {
  const header = retryAfterMs(response.headers.get('retry-after'), now());
  if (header !== null) {
    return header <= MAX_DELAY_MS ? header : null;
  }
  return backoffMs(attempt, random);
}

function backoffMs(attempt: number, random: () => number) {
  const exponential = 200 * 2 ** (attempt - 1);
  const jitter = 0.5 + random() * 0.5;
  return Math.min(MAX_DELAY_MS, Math.round(exponential * jitter));
}

function retryAfterMs(header: string | null, nowMs: number) {
  if (!header) {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const dated = Date.parse(header);
  if (Number.isFinite(dated)) {
    return Math.max(0, dated - nowMs);
  }
  return null;
}

function readCompletion(body: unknown) {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const record = body as {
    model?: unknown;
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  };
  const content = record.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    return null;
  }
  return {
    content,
    model: typeof record.model === 'string' ? record.model : '',
    promptTokens: count(record.usage?.prompt_tokens),
    completionTokens: count(record.usage?.completion_tokens),
  };
}

function count(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
}

function isTimeout(error: unknown) {
  return (
    (error instanceof Error && error.name === 'TimeoutError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}
