import { createContext, useContext } from "react";

export interface ToastInput {
  message: string;
  tone?: "default" | "danger";
}

export const ToastContext = createContext<((toast: ToastInput) => void) | null>(null);

/** `const toast = useToast(); toast({ message: "Saved" })`, for any component inside `ToastProvider`. */
export function useToast(): (toast: ToastInput) => void {
  const show = useContext(ToastContext);
  if (show === null) throw new Error("useToast was called outside ToastProvider");
  return show;
}
