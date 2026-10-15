import type { ReactNode } from 'react';
import { FieldError } from '../../features/auth/FieldError';
import { fieldDescribedBy } from './field-described-by';
import { Label } from './Label';

export function FormField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = fieldDescribedBy(id, error);
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="grid gap-2" data-described-by={describedBy}>
      <Label htmlFor={id}>{label}</Label>
      {hint ? (
        <p id={hintId} className="text-sm leading-6 text-ink-soft">
          {hint}
        </p>
      ) : null}
      {children}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}
