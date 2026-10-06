import { useCallback, useRef, useState, type ReactNode } from "react";
import { ToastContext, type ToastInput } from "./use-toast";

const SHOWN_MS = 6000;

interface Shown extends ToastInput {
  id: number;
}

/** Holds the toasts of the console and draws them in the corner; each leaves by itself or by its button. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly Shown[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (toast: ToastInput) => {
      counter.current += 1;
      const id = counter.current;
      setToasts((current) => [...current, { ...toast, id }]);
      setTimeout(() => {
        dismiss(id);
      }, SHOWN_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext value={show}>
      {children}
      <div className="admin-toasts" data-print="hide" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className="admin-toast" data-tone={toast.tone ?? "default"}>
            <span>{toast.message}</span>
            <button
              type="button"
              className="admin-view"
              onClick={() => {
                dismiss(toast.id);
              }}
            >
              Dismiss
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}
