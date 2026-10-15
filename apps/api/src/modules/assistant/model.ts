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
  readonly code: 'MISSING_API_KEY' | 'TIMEOUT' | 'RATE_LIMITED' | 'UNAVAILABLE';

  constructor(code: ModelRequestError['code'], message: string) {
    super(message);
    this.name = 'ModelRequestError';
    this.code = code;
  }
}

export const MODEL_HISTORY_LIMIT = 12;
