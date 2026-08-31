import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
}

export default function Modal({ open, onClose, title, children, maxWidth = "max-w-md" }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    // The card is capped at the viewport and scrolls its own body. Without
    // this, a tall form (new lead, new invoice) simply runs off the bottom of
    // a phone screen with no way to reach the submit button — the page behind
    // is fixed, so nothing scrolls. dvh, not vh, so the mobile browser's
    // address bar doesn't eat the bottom of the dialog.
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 touch-none bg-black/60" onClick={onClose} />
      <div
        className={`relative flex max-h-[calc(100dvh-2rem)] w-full ${maxWidth} animate-in flex-col fade-in zoom-in-95 rounded-2xl border border-border bg-card shadow-2xl`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain p-5">{children}</div>
      </div>
    </div>
  );
}
