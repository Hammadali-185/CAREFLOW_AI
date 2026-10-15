import { z } from 'zod';

const webConfigSchema = z.object({
  VITE_API_BASE_URL: z.url('VITE_API_BASE_URL must be an absolute URL.'),
});

export type WebConfig = {
  apiBaseUrl: string;
};

export function loadWebConfig(source: { VITE_API_BASE_URL?: string }): WebConfig {
  const parsed = webConfigSchema.safeParse({
    VITE_API_BASE_URL: source.VITE_API_BASE_URL,
  });

  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => issue.message).join('\n');
    throw new Error(
      `Frontend configuration is invalid.\n${details}\nCopy apps/web/.env.example to apps/web/.env and set VITE_API_BASE_URL.`,
    );
  }

  return {
    apiBaseUrl: parsed.data.VITE_API_BASE_URL.replace(/\/$/, ''),
  };
}
