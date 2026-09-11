import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { inputCls } from "@/lib/ui-styles";

export default function SecurityPage() {
  const { user, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      if (password !== confirm) throw new Error("The passwords do not match.");
      await apiRequest("POST", "/api/security/password", { currentPassword, password }, { replacesSession: true });
      setCurrentPassword(""); setPassword(""); setConfirm(""); setSaved(true);
    } catch (e: any) { setError(e.message || "Could not save. Please try again."); }
    finally { setBusy(false); }
  }
  return (
    <main className="mx-auto my-8 max-w-lg rounded-2xl border border-border bg-card p-6 text-foreground">
      <p className="text-sm text-muted-foreground">CJM Trades · {user?.name}</p>
      <h1 className="mt-2 text-2xl font-bold">{user?.securitySetupRequired ? "Set your password" : "Password and devices"}</h1>
      <p className="my-3 text-sm text-muted-foreground">{user?.securitySetupRequired ? "Choose a password with at least 12 characters to continue." : "Change your password or sign out your other devices."}</p>
      {error && <p role="alert" className="my-3 text-destructive">{error}</p>}
      {message && <p role="status" className="my-3 text-sm">{message}</p>}
      {saved ? (
        <div className="space-y-4">
          <p role="status">Password saved. Your other devices have been signed out.</p>
          <button className="h-11 rounded-lg bg-primary px-4 text-primary-foreground" onClick={() => { location.hash = "/today"; location.reload(); }}>Continue to the suite</button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <label className="block">Current password or PIN
            <input required className={inputCls} type="password" autoComplete="current-password" maxLength={128} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
          </label>
          <label className="block">New password (12+ characters)
            <input required minLength={12} maxLength={72} className={inputCls} type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />
          </label>
          <label className="block">Confirm password
            <input required maxLength={72} className={inputCls} type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} />
          </label>
          <button disabled={busy} className="h-11 rounded-lg bg-primary px-4 text-primary-foreground disabled:opacity-50">{busy ? "Saving…" : "Save password"}</button>
        </form>
      )}
      {!user?.securitySetupRequired && !saved && (
        <button disabled={busy} className="mt-5 block underline" onClick={async () => {
          setBusy(true); setError(""); setMessage("");
          try { await apiRequest("POST", "/api/security/revoke-sessions"); setMessage("Other sessions have been signed out."); }
          catch (e: any) { setError(e.message); }
          finally { setBusy(false); }
        }}>Sign out other devices</button>
      )}
      <button className="mt-5 text-sm underline" onClick={() => logout()}>Sign out</button>
    </main>
  );
}
