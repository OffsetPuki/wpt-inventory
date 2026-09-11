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
    [ready, setReady] = useState(false);
  useEffect(() => {
    active.current = false;
    setReady(false);
    if (!open) return;
    {
      baseline.current = JSON.stringify(latest.current.values);
      savedVersion.current = version;
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) || "null");
        if (saved?.values && typeof saved.values === "object") {
          latest.current.restore(saved.values);
          savedVersion.current = saved.version;
          setRecovered(true);
        } else setRecovered(false);
      } catch {}
      active.current = true;
      setReady(true);
    }
    return () => {
      active.current = false;
    };
  }, [key, open]);
  useLayoutEffect(() => {
    if (!ready || !open || !active.current) return;
    try {
      const value = JSON.stringify(values);
      if (value === baseline.current) sessionStorage.removeItem(key);
      else
        sessionStorage.setItem(
          key,
          JSON.stringify({ values, version: savedVersion.current }),
        );
    } catch {}
  }, [key, open, ready, values]);
  const clear = () => {
    active.current = false;
    try {
      sessionStorage.removeItem(key);
    } catch {}
  };
  return {
    clear,
    expectedVersion: ready ? savedVersion.current : version,
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
