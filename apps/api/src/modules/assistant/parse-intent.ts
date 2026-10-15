import { modelIntentSchema, type ModelIntent } from '@careflow/shared';

const blockedKeys = new Set(['sql', 'query', 'command', 'tool', 'tools', 'function_call']);

export function parseModelIntent(
  content: string,
): { ok: true; intent: ModelIntent } | { ok: false } {
  let raw: unknown;
  try {
    raw = JSON.parse(stripFence(content));
  } catch {
    return { ok: false };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false };
  }

  const record = raw as Record<string, unknown>;
  if (Object.keys(record).some((key) => blockedKeys.has(key))) {
    return { ok: false };
  }

  const parsed = modelIntentSchema.safeParse({
    ...record,
    serviceQuery: emptyToNull(record.serviceQuery),
    datePreference: emptyToNull(record.datePreference),
    timePreference: emptyToNull(record.timePreference),
    staffQuery: emptyToNull(record.staffQuery),
    clarificationQuestion: emptyToNull(record.clarificationQuestion),
  });
  return parsed.success ? { ok: true, intent: parsed.data } : { ok: false };
}

function stripFence(content: string) {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}

function emptyToNull(value: unknown) {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
