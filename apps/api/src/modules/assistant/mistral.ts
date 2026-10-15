import { ModelRequestError, type ModelClient, type ModelMessage } from './model.js';

const endpoint = 'https://api.mistral.ai/v1/chat/completions';

export function createMistralClient(options: {
  apiKey: string | undefined;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}): ModelClient {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async complete(input) {
      if (!options.apiKey) {
        throw new ModelRequestError(
          'MISSING_API_KEY',
          'The scheduling assistant is not configured. You can book from the form.',
        );
      }

      const started = Date.now();
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
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
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (error) {
        if (isTimeout(error)) {
          throw new ModelRequestError(
            'TIMEOUT',
            'The scheduling assistant took too long. You can book from the form.',
          );
        }
        throw new ModelRequestError(
          'UNAVAILABLE',
          'The scheduling assistant is unavailable. You can book from the form.',
        );
      }

      const latencyMs = Date.now() - started;
      if (response.status === 429) {
        throw new ModelRequestError(
          'RATE_LIMITED',
          'The scheduling assistant is busy. Wait a moment or use the booking form.',
        );
      }
      if (!response.ok) {
        throw new ModelRequestError(
          'UNAVAILABLE',
          'The scheduling assistant is unavailable. You can book from the form.',
        );
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new ModelRequestError(
          'UNAVAILABLE',
          'The scheduling assistant is unavailable. You can book from the form.',
        );
      }

      const parsed = readCompletion(body);
      if (!parsed) {
        throw new ModelRequestError(
          'UNAVAILABLE',
          'The scheduling assistant is unavailable. You can book from the form.',
        );
      }
      return {
        content: parsed.content,
        model: parsed.model || options.model,
        promptTokens: parsed.promptTokens,
        completionTokens: parsed.completionTokens,
        latencyMs,
      };
    },
  };
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
