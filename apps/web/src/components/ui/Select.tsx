import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'focus-ring min-h-11 w-full rounded-md border border-line bg-white px-3 text-base text-ink aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
}
