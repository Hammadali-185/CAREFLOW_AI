export function TypingIndicator() {
  return (
    <p className="text-sm text-ink-soft" role="status">
      The assistant is writing
      <span aria-hidden="true">…</span>
    </p>
  );
}
