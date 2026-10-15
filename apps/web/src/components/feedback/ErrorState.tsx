import type { ReactNode } from 'react';

export function ErrorState({
  title,
  description,
  action,
  level = 1,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  level?: 1 | 2;
}) {
  const Heading = level === 2 ? 'h2' : 'h1';
  return (
    <div role="alert" className="rounded-lg border border-danger bg-danger-soft px-4 py-8 sm:px-6">
      <Heading className="font-display text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
        {title}
      </Heading>
      <p className="mt-3 text-base leading-7 text-ink-soft">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
