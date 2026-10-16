import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Alert, type AlertTone } from './Alert';
import { ToastContext } from './toast-context';

type ToastItem = {
  id: string;
  tone: AlertTone;
  title: string;
  message: string;
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (message: string, tone: AlertTone = 'info', title?: string) => {
      const id = crypto.randomUUID();
      const resolvedTitle = title ?? (tone === 'danger' ? 'Something went wrong' : 'Notice');
      setToasts((current) => [...current, { id, tone, title: resolvedTitle, message }]);
      window.setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-40 grid gap-2 sm:left-auto sm:w-96"
      >
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <Alert tone={toast.tone} title={toast.title}>
              {toast.message}
            </Alert>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
