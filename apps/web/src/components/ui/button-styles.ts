import { cn } from '../../lib/utils';

const variants = {
  primary: 'bg-teal text-white hover:bg-teal-deep',
  secondary: 'border border-line bg-white text-ink hover:bg-foam',
  ghost: 'text-teal-deep hover:bg-foam',
} as const;

export type ButtonVariant = keyof typeof variants;

export function buttonClassName(variant: ButtonVariant = 'primary', className?: string) {
  return cn(
    'focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-base font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
    variants[variant],
    className,
  );
}
