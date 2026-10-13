import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from 'react-dom';
import { X } from "lucide-react";

const DismissContext = createContext<() => void>(() => {});
let openCount = 0;
let originalOverflow = '';

export function ModalClose({ children, className }: { children: ReactNode; className?: string }) {
  const dismiss = useContext(DismissContext);
  return <button type="button" className={className} onClick={dismiss}>{children}</button>;
}

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
  preservesDraft?: boolean;
  footer?: ReactNode;
  focusDialog?: boolean;
  hasUnsavedChanges?: boolean;
  busy?: boolean;
}

export default function Modal({
  open,
  onClose,
  title,
  children,
  maxWidth = "max-w-md",
  preservesDraft = false,
  footer,
  focusDialog = true,
  hasUnsavedChanges,
  busy = false,
}: ModalProps) {
  const titleId = useId();
  const card = useRef<HTMLDivElement>(null);
  const dirty = useRef(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const confirming = useRef(false);
  confirming.current = confirmDiscard;
  const keepEditing = useRef<HTMLButtonElement>(null);
  const unsaved = useRef(hasUnsavedChanges);
  unsaved.current = hasUnsavedChanges;
  const draftPreserved = useRef(preservesDraft);
  draftPreserved.current = preservesDraft;
  const close = useRef(onClose);
  close.current = onClose;
  const working = useRef(busy);
  working.current = busy;
  const dismiss = () => {
    if (working.current) return;
    if (confirming.current) { setConfirmDiscard(false); return; }
    if (draftPreserved.current || !(unsaved.current ?? dirty.current)) close.current();
    else setConfirmDiscard(true);
  };
  useEffect(() => {
    if (!open) return;
    dirty.current = false;
    setConfirmDiscard(false);
    const previous = document.activeElement as HTMLElement | null;
    if (openCount++ === 0) originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        card.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
        ) ?? [],
      ).filter((el) => !el.matches(':disabled') && el.getClientRects().length > 0);
    (
      (!focusDialog && card.current?.querySelector<HTMLElement>(
        "input:not([type=hidden]), select, textarea",
      )) || card.current
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
            document.activeElement === card.current ||
            !card.current?.contains(document.activeElement))
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === card.current ||
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
      if (--openCount === 0) document.body.style.overflow = originalOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  useEffect(() => {
    if (confirmDiscard) keepEditing.current?.focus();
    else if (open) card.current?.focus({ preventScroll: true });
  }, [confirmDiscard]);
  if (!open) return null;
  return createPortal(
    <DismissContext.Provider value={dismiss}><div className="fixed inset-0 z-50 flex items-end justify-center p-2 sm:items-center sm:p-4">
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
        aria-busy={busy || undefined}
        tabIndex={-1}
        onClickCapture={event => { if (busy) { event.preventDefault(); event.stopPropagation(); } }}
        onSubmitCapture={event => { if (busy) { event.preventDefault(); event.stopPropagation(); } }}
        onChangeCapture={() => {
          dirty.current = true;
        }}
        className={`suite-modal relative flex max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)] w-full ${maxWidth} animate-in flex-col fade-in zoom-in-95 rounded-2xl border border-border bg-card shadow-2xl`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 id={titleId} className="min-w-0 break-words text-lg font-semibold text-foreground">
            {confirmDiscard ? 'Discard changes?' : title}
          </h2>
          <button
            type="button"
            disabled={busy}
            onClick={dismiss}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div hidden={confirmDiscard} className="suite-form min-h-0 overflow-y-auto overscroll-contain p-5"><fieldset disabled={busy} className="min-w-0 border-0 p-0 m-0">{children}</fieldset></div>
        {footer && <div hidden={confirmDiscard} className="shrink-0 border-t border-border px-5 py-3"><fieldset disabled={busy} className="min-w-0 border-0 p-0 m-0">{footer}</fieldset></div>}
        {confirmDiscard && <div className="p-5"><p className="mb-5 text-sm text-muted-foreground">Your latest edits have not been saved.</p><div className="flex flex-wrap justify-end gap-2"><button ref={keepEditing} type="button" className="min-h-11 rounded-xl bg-primary px-4 font-medium text-primary-foreground" onClick={() => setConfirmDiscard(false)}>Keep editing</button><button type="button" className="min-h-11 rounded-xl border border-border px-4 font-medium text-destructive" onClick={() => close.current()}>Discard changes</button></div></div>}
      </div>
    </div></DismissContext.Provider>, document.body
  );
}
