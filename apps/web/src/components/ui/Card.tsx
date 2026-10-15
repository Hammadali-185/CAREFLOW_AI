import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export function Card({
  title,
  eyebrow,
  children,
  className,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article
      className={cn('min-w-0 rounded-lg border border-line bg-white p-5 shadow-card', className)}
    >
      {eyebrow ? (
        <p className="text-sm font-semibold tracking-wide text-teal uppercase">{eyebrow}</p>
      ) : null}
      <h3 className="mt-2 font-display text-2xl font-semibold tracking-tight text-balance text-ink">
        {title}
      </h3>
      <div className="mt-3 text-base leading-7 text-ink-soft">{children}</div>
    </article>
  );
}
