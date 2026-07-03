import { useState, useEffect, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import Logo from "@/components/Logo";
import { LogIn, Loader2 } from "lucide-react";

export default function LoginPage() {
  const { login } = useAuth();
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // The username autocomplete used to call an unauthenticated endpoint
  // that listed every user — removed because it handed an attacker half
  // of every credential pair. The field is just a typed name now.

  const { data: settings } = useQuery<{ companyName: string; companyTagline?: string }>({
    queryKey: ["settings"],
    queryFn: async () => (await apiRequest("GET", "/api/settings")).json(),
    refetchInterval: false,
  });

  async function attemptLogin() {
    if (submitting || !name.trim() || pin.length !== 4) return;
    setSubmitting(true);
    try {
      await login(name.trim(), pin);
      // App re-renders to the authenticated router; "/" redirects by role.
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Could not sign in",
        description: err?.message || "Check your name and PIN and try again.",
      });
      setPin("");
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || pin.length !== 4) {
      toast({
        variant: "destructive",
        title: "Missing information",
        description: "Enter your name and a 4-digit PIN.",
      });
      return;
    }
    attemptLogin();
  }

  // Sign in automatically the moment a 4-digit PIN is entered (no button press).
  useEffect(() => {
    if (pin.length === 4 && name.trim()) attemptLogin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size="lg" showText={false} />
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-foreground">
            {settings?.companyName || "CJM Metals"}
          </h1>
          <p className="mt-1 text-base text-muted-foreground">
            {settings?.companyTagline || "Custom metalwork. No shortcuts."}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-xl sm:p-8"
        >
          <div className="flex flex-col gap-2">
            <label htmlFor="name" className="text-base font-medium text-foreground">
              Your name
            </label>
            <input
              id="name"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Type your name"
              className="h-14 rounded-xl border border-input bg-background px-4 text-lg text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="pin" className="text-base font-medium text-foreground">
              4-digit PIN
            </label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={pin}
              onChange={(e) =>
                setPin(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              placeholder="••••"
              className="h-14 rounded-xl border border-input bg-background px-4 text-center text-2xl tracking-[0.5em] text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-ring"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="mt-1 flex h-14 items-center justify-center gap-2 rounded-xl bg-primary text-lg font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {submitting ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <LogIn className="h-5 w-5" />
            )}
            Sign in
          </button>
        </form>

        {/* Public legal pages — server-rendered routes, open in a new tab. */}
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <a href="/privacy" target="_blank" rel="noopener" className="hover:text-foreground hover:underline">
            Privacy Policy
          </a>
          <span className="mx-2">·</span>
          <a href="/eula" target="_blank" rel="noopener" className="hover:text-foreground hover:underline">
            Terms (EULA)
          </a>
          <span className="mx-2">·</span>
          <a href="mailto:support@cjmmetals.com?subject=CJM%20Metals%20suite%20support" className="hover:text-foreground hover:underline">
            Contact support
          </a>
        </p>
      </div>
    </div>
  );
}
