export function fieldDescribedBy(id: string, error?: string, hint = false) {
  const ids = [hint ? `${id}-hint` : undefined, error ? `${id}-error` : undefined].filter(
    (value): value is string => Boolean(value),
  );
  return ids.length > 0 ? ids.join(' ') : undefined;
}
