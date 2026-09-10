import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
}

export default function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = "max-w-md",
}: ModalProps) {
  const titleId = useId();
  const card = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;
  const dismiss = () => {
    if (!dirty.current || window.confirm("Discard your unsaved changes?"))
      close.current();
  };
  useEffect(() => {
    if (!open) return;
    dirty.current = false;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        card.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
        ) ?? [],
      ).filter((el) => el.getClientRects().length > 0);
    (
      card.current?.querySelector<HTMLElement>(
        "input:not([type=hidden]), select, textarea",
      ) ?? card.current
    )?.focus();
    const onKey = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll("[data-cjm-modal]");
      if (dialogs[dialogs.length - 1] !== card.current) return;
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
      if (e.key === "Tab") {
        const items = focusable();
        const first = items[0],
          last = items[items.length - 1];
        if (!first) {
          e.preventDefault();
          card.current?.focus();
        } else if (
          e.shiftKey &&
          (document.activeElement === first ||
            !card.current?.contains(document.activeElement))
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            !card.current?.contains(document.activeElement))
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 touch-none bg-black/60"
        onClick={dismiss}
        aria-hidden="true"
      />
      <div
        ref={card}
        data-cjm-modal
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onChangeCapture={() => {
          dirty.current = true;
        }}
        className={`relative flex max-h-[calc(100dvh-2rem)] w-full ${maxWidth} animate-in flex-col fade-in zoom-in-95 rounded-2xl border border-border bg-card shadow-2xl`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 id={titleId} className="text-lg font-semibold text-foreground">
            {title}
          </h2>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
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
