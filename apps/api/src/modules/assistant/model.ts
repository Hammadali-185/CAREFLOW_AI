export type ModelMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ModelCompletion = {
  content: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
};

export type ModelClient = {
  complete(input: { system: string; messages: ModelMessage[] }): Promise<ModelCompletion>;
};

export class ModelRequestError extends Error {
  readonly code: 'MISSING_API_KEY' | 'TIMEOUT' | 'RATE_LIMITED' | 'PROVIDER_AUTH' | 'UNAVAILABLE';
  readonly providerStatus: number | null;

  constructor(
    code: ModelRequestError['code'],
    message: string,
    providerStatus: number | null = null,
  ) {
    super(message);
    this.name = 'ModelRequestError';
    this.code = code;
    this.providerStatus = providerStatus;
  }
}

export const MODEL_HISTORY_LIMIT = 12;
