import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

const tones = {
  info: 'border-l-info bg-info-soft',
  warning: 'border-l-warning bg-warning-soft',
  success: 'border-l-success bg-success-soft',
  danger: 'border-l-danger bg-danger-soft',
} as const;

export type AlertTone = keyof typeof tones;

export function Alert({
  tone,
  title,
  children,
}: {
  tone: AlertTone;
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-md border border-line border-l-4 px-4 py-3', tones[tone])}
    >
      <p className="font-semibold text-ink">{title}</p>
      <div className="mt-1 text-sm leading-6 text-ink-soft">{children}</div>
    </div>
  );
}
