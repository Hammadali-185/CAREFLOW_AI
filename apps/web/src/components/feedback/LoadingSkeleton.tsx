export function LoadingSkeleton({ label = 'Loading' }: { label?: string }) {
  return (
    <div aria-busy="true" aria-live="polite" className="grid gap-3">
      <span className="sr-only">{label}</span>
      <div className="h-8 w-2/3 animate-pulse rounded-md bg-paper-deep" />
      <div className="h-4 w-full animate-pulse rounded-md bg-paper-deep" />
      <div className="h-4 w-5/6 animate-pulse rounded-md bg-paper-deep" />
    </div>
  );
}
