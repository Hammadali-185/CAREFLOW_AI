export function LoadingIndicator({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 text-ink-soft">
      <span
        aria-hidden="true"
        className="h-4 w-4 rounded-full border-2 border-line border-t-teal motion-safe:animate-spin"
      />
      <span>{label}</span>
    </div>
  );
}
