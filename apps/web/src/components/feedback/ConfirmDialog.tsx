import { useEffect, useId, useRef } from 'react';
import { Button } from '../ui/Button';

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    }
    if (!open && dialog.open) {
      if (typeof dialog.close === 'function') {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(calc(100vw-2rem),28rem)] overflow-y-auto rounded-lg border border-line bg-white p-4 text-ink shadow-card backdrop:bg-ink/40 sm:p-6"
      onClose={onClose}
    >
      <h2 id={titleId} className="font-display text-2xl font-semibold tracking-tight">
        {title}
      </h2>
      <p className="mt-3 text-base leading-7 text-ink-soft">{description}</p>
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            onConfirm();
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
