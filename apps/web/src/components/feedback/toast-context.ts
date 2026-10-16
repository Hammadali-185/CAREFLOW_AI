import { createContext, useContext } from 'react';
import type { AlertTone } from './Alert';

export type ToastApi = {
  show: (message: string, tone?: AlertTone, title?: string) => void;
};

export const ToastContext = createContext<ToastApi | null>(null);

export function useToast() {
  const toast = useContext(ToastContext);
  if (!toast) {
    throw new Error('useToast must be used within ToastProvider.');
  }
  return toast;
}
