import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

const tones = {
  neutral: 'bg-paper-deep text-ink',
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
} as const;

export type BadgeTone = keyof typeof tones;

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-sm font-semibold',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
