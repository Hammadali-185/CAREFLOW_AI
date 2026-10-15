import type { ReactNode } from 'react';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-sm font-semibold tracking-wide text-teal uppercase">{eyebrow}</p>
        ) : null}
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-balance text-ink sm:text-4xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-3 text-base leading-7 text-ink-soft">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
