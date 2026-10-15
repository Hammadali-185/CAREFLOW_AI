import type { ComponentProps } from 'react';
import { Button } from './Button';

export function LoadingButton({
  loading = false,
  children,
  disabled,
  ...props
}: ComponentProps<typeof Button> & { loading?: boolean }) {
  return (
    <Button {...props} disabled={disabled || loading} aria-busy={loading || undefined}>
      {children}
      {loading ? <span className="sr-only"> Loading</span> : null}
    </Button>
  );
}
