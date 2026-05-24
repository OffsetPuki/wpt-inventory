import { useEffect, useState } from "react";

export type ToastVariant = "default" | "destructive" | "success";

export interface ToastItem {
  id: number;
  title?: string;
  description?: string;
  variant?: ToastVariant;
}

type Listener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
const listeners = new Set<Listener>();
let counter = 0;

function emit() {
  const snapshot = [...toasts];
  for (const l of listeners) l(snapshot);
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(opts: Omit<ToastItem, "id">): number {
  const id = ++counter;
  toasts = [...toasts, { variant: "default", ...opts, id }];
  emit();
  setTimeout(() => dismissToast(id), 4500);
  return id;
}

export function useToast() {
  const [state, setState] = useState<ToastItem[]>(toasts);
  useEffect(() => {
    listeners.add(setState);
    setState([...toasts]);
    return () => {
      listeners.delete(setState);
    };
  }, []);
  return { toasts: state, toast, dismiss: dismissToast };
}
