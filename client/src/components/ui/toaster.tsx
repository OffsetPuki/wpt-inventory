import { useToast, dismissToast, type ToastVariant } from "./use-toast";
import { cn } from "@/lib/utils";
import { X, CheckCircle2, AlertCircle, Info } from "lucide-react";

export { toast } from "./use-toast";

const VARIANT: Record<ToastVariant, { ring: string; icon: typeof Info }> = {
  default: { ring: "border-border", icon: Info },
  success: { ring: "border-green-500/40", icon: CheckCircle2 },
  destructive: { ring: "border-destructive/50", icon: AlertCircle },
};

export function Toaster() {
  const { toasts } = useToast();

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((t) => {
        const variant = VARIANT[t.variant ?? "default"];
        const Icon = variant.icon;
        return (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-lg border bg-popover p-4 shadow-xl animate-in fade-in slide-in-from-bottom-2",
              variant.ring
            )}
          >
            <Icon
              className={cn(
                "mt-0.5 h-5 w-5 shrink-0",
                t.variant === "success" && "text-green-400",
                t.variant === "destructive" && "text-destructive",
                (!t.variant || t.variant === "default") && "text-primary"
              )}
            />
            <div className="flex-1 min-w-0">
              {t.title && (
                <p className="text-sm font-semibold text-foreground">{t.title}</p>
              )}
              {t.description && (
                <p className="text-sm text-muted-foreground break-words">
                  {t.description}
                </p>
              )}
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
