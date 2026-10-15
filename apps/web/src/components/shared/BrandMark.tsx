import { Link } from 'react-router';

export function BrandMark({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="focus-ring flex min-w-0 items-center gap-2 rounded-md">
      <span
        aria-hidden="true"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-teal text-sm font-bold text-white"
      >
        CF
      </span>
      <span className="truncate font-display text-lg font-semibold tracking-tight text-ink">
        CareFlow AI
      </span>
    </Link>
  );
}
