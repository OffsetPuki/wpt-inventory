import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "./auth";
// Legacy forms keep their existing state setters. This adapter gives them the
// same account-scoped recovery as the job forms without replacing user input
// when live query data refreshes behind the dialog.
export function useDialogDraft(
  name: string,
  open: boolean,
  values: any,
  restore: (v: any) => void,
  version?: number,
) {
  const { user } = useAuth(),
    key = `suite-dialog:${user?.id}:${name}`;
  const latest = useRef({ values, restore });
  latest.current = { values, restore };
  const baseline = useRef(""),
    active = useRef(false),
    savedVersion = useRef(version);
  const [recovered, setRecovered] = useState(false),
    [session, setSession] = useState<{ key: string; version?: number } | null>(null);
  const initialized = useRef<typeof session>(null);
  useEffect(() => {
    active.current = false;
    // Wait for the form's opening effect to populate its fields before taking
    // a baseline. Otherwise an untouched saved record becomes a false draft.
    setSession(open ? { key, version } : null);
    setRecovered(false);
    return () => {
      active.current = false;
    };
  }, [key, open]);
  useLayoutEffect(() => {
    if (!open || !session || session.key !== key) return;
    if (initialized.current !== session) {
      initialized.current = session;
      baseline.current = JSON.stringify(latest.current.values);
      savedVersion.current = session.version;
      active.current = true;
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
        if (saved?.values && typeof saved.values === 'object') {
          latest.current.restore(saved.values);
          savedVersion.current = saved.version;
          setRecovered(true);
          return;
        }
      } catch {}
    }
    if (!active.current) return;
    try {
      const value = JSON.stringify(values);
      if (value === baseline.current) sessionStorage.removeItem(key);
      else
        sessionStorage.setItem(
          key,
          JSON.stringify({ values, version: savedVersion.current }),
        );
    } catch {}
  }, [key, open, session, values]);
  const clear = () => {
    active.current = false;
    try {
      sessionStorage.removeItem(key);
    } catch {}
  };
  return {
    clear,
    reset: (values: any, nextVersion?: number) => {
      clear();
      baseline.current = JSON.stringify(values);
      savedVersion.current = nextVersion;
      setRecovered(false);
      active.current = true;
    },
    expectedVersion: session?.key === key && initialized.current === session ? savedVersion.current : version,
    notice: recovered ? (
      <p role="status" className="rounded border p-3 text-sm">
        Recovered your unfinished draft.{" "}
        <button
          type="button"
          className="underline"
          onClick={() => {
            clear();
            latest.current.restore(JSON.parse(baseline.current));
            setRecovered(false);
            savedVersion.current = version;
            active.current = true;
          }}
        >
          Discard recovered edits
        </button>
      </p>
    ) : null,
  };
}
