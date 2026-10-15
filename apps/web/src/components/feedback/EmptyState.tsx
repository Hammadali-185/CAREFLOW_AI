import type { ReactNode } from 'react';

export function EmptyState({
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
    <div className="mx-auto max-w-lg rounded-lg border border-dashed border-line bg-white px-4 py-10 text-center sm:px-6 sm:py-12">
      <Heading className="font-display text-2xl font-semibold tracking-tight text-balance text-ink sm:text-3xl">
        {title}
      </Heading>
      <p className="mt-3 text-base leading-7 text-ink-soft">{description}</p>
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}
