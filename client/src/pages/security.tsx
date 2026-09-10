import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { apiRequest, setAuthToken } from "@/lib/queryClient";
import { inputCls } from "@/lib/ui-styles";

export default function SecurityPage() {
  const { user, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [currentOtp, setCurrentOtp] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [otp, setOtp] = useState("");
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(
    null,
  );
  const [codes, setCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!setup) {
        setSetup(
          await (
            await apiRequest("POST", "/api/security/enroll", {
              currentPassword,
              otp: currentOtp,
            })
          ).json(),
        );
        setCurrentPassword("");
        setCurrentOtp("");
      } else {
        if (password !== confirm)
          throw new Error("The passwords do not match.");
        const result = await (
          await apiRequest("POST", "/api/security/complete", { password, otp })
        ).json();
        setAuthToken(result.token);
        setCodes(result.recoveryCodes);
        setPassword("");
        setConfirm("");
        setOtp("");
        setSetup(null);
      }
    } catch (e: any) {
      setError(e.message || "Could not save. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  function downloadCodes() {
    const url = URL.createObjectURL(
      new Blob(
        [
          `CJM Trades recovery codes for ${user?.name}\nKeep these private. Each code works once.\n\n${codes.join("\n")}\n`,
        ],
        { type: "text/plain" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "cjm-recovery-codes.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <main className="mx-auto my-8 max-w-lg rounded-2xl border border-border bg-card p-6 text-foreground">
      <p className="text-sm text-muted-foreground">CJM Trades · {user?.name}</p>
      <h1 className="mt-2 text-2xl font-bold">Protect your account</h1>
      <p className="my-3 text-sm text-muted-foreground">
        Use a password and an authenticator app for owner access. Existing
        records and account permissions stay with this account.
      </p>
      {error && (
        <p role="alert" className="my-3 text-destructive">
          {error}
        </p>
      )}
      {codes.length ? (
        <div className="space-y-4">
          <h2 className="font-semibold">Save your recovery codes</h2>
          <p className="text-sm">
            Use one if you lose your authenticator. These codes are shown only
            now.
          </p>
          <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-sm">
            {codes.join("\n")}
          </pre>
          <button className="underline" onClick={downloadCodes}>
            Download recovery codes
          </button>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={saved}
              onChange={(e) => setSaved(e.target.checked)}
            />
            I saved these codes somewhere private.
          </label>
          <button
            disabled={!saved}
            className="h-11 rounded-lg bg-primary px-4 text-primary-foreground disabled:opacity-50"
            onClick={() => location.reload()}
          >
            Continue to the suite
          </button>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          {!setup ? (
            <>
              <label className="block">
                Current password or PIN
                <input
                  required
                  className={inputCls}
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </label>
              {user?.mfaEnabled && (
                <label className="block">
                  Authenticator or recovery code
                  <input
                    required
                    className={inputCls}
                    autoComplete="one-time-code"
                    value={currentOtp}
                    onChange={(e) => setCurrentOtp(e.target.value)}
                  />
                </label>
              )}
            </>
          ) : (
            <>
              <p className="text-sm">
                1. Scan this QR code in your authenticator app.
              </p>
              <img
                src={setup.qr}
                alt="Authenticator setup QR code"
                width={200}
                height={200}
              />
              <details>
                <summary>Enter a setup key instead</summary>
                <code className="break-all">{setup.secret}</code>
              </details>
              <label className="block">
                2. New password (12+ characters)
                <input
                  required
                  minLength={12}
                  maxLength={64}
                  className={inputCls}
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <label className="block">
                Confirm password
                <input
                  required
                  className={inputCls}
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </label>
              <label className="block">
                3. Six-digit authenticator code
                <input
                  required
                  pattern="[0-9]{6}"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className={inputCls}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                />
              </label>
            </>
          )}
          <button
            disabled={busy}
            className="h-11 rounded-lg bg-primary px-4 text-primary-foreground disabled:opacity-50"
          >
            {busy
              ? "Saving…"
              : setup
                ? "Secure my account"
                : "Set up authenticator"}
          </button>
        </form>
      )}
      {!user?.securitySetupRequired && !codes.length && (
        <button
          className="mt-5 block underline"
          onClick={async () => {
            try {
              await apiRequest("POST", "/api/security/revoke-sessions");
              setError("Other sessions have been signed out.");
            } catch (e: any) {
              setError(e.message);
            }
          }}
        >
          Sign out other devices
        </button>
      )}
      <button className="mt-5 text-sm underline" onClick={() => logout()}>
        Sign out
      </button>
    </main>
  );
}
