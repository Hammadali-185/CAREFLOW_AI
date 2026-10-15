import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

export function Input({ ref, className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      ref={ref}
      className={cn(
        'focus-ring min-h-11 w-full rounded-md border border-line bg-white px-3 text-base text-ink placeholder:text-ink-soft/70 aria-invalid:border-danger',
        className,
      )}
      {...props}
    />
  );
}
