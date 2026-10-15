import { Button } from '../../components/ui/Button';

export function ConfirmationCard({
  title,
  detail,
  action,
  pending,
  onConfirm,
}: {
  title: string;
  detail: string;
  action: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <section className="max-w-xl rounded-lg border border-line bg-white p-4" aria-label={title}>
      <h2 className="font-display text-xl font-semibold text-ink">{title}</h2>
      <p className="mt-2 text-base leading-7 whitespace-pre-wrap text-ink-soft">{detail}</p>
      <div className="mt-4">
        <Button disabled={pending} onClick={onConfirm}>
          {pending ? 'Saving…' : action}
        </Button>
      </div>
    </section>
  );
}
