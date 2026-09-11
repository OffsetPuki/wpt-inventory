import { useEffect, useState } from "react";
import { getAuthToken, queryClient } from "./queryClient";

export const TOPIC_KEYS: Record<string, string[]> = {
  inventory: [
    "project-unbilled",
    "quote-costing",
    "suite-timeline",
    "suite-schedule",
    "suite-costs",
    "inventory",
    "items",
    "item",
    "project-usage",
    "project-checklist",
    "checklist",
    "stats",
    "suite-job",
    "suite-today",
    "project-fin-summary",
  ],
  jobs: [
    "suite-files",
    "suite-timeline",
    "suite-schedule",
    "project",
    "projects",
    "project-tasks",
    "project-checklist",
    "checklist",
    "pm-",
    "suite-job",
    "suite-today",
    "project-fin-summary",
    "dashboard",
    "attention",
  ],
  finance: [
    "quote-costing",
    "suite-timeline",
    "suite-schedule",
    "finance",
    "project-fin-summary",
    "project-unbilled",
    "crm-client",
    "suite-job",
    "suite-today",
    "suite-health",
  ],
  time: [
    "quote-costing",
    "suite-timeline",
    "suite-time-review",
    "pm-time",
    "hr-payroll",
    "hr-stats",
    "project-fin-summary",
    "project-unbilled",
    "pm-tasks",
    "suite-job",
    "suite-today",
  ],
  marketing: ["marketing"],
  crm: ["marketing", "crm-", "quote", "quotes", "suite-job", "suite-today"],
  team: [
    "suite-schedule",
    "quote-costing",
    "project-fin-summary",
    "project-unbilled",
    "hr-",
    "users",
    "suite-job",
    "suite-today",
  ],
  communication: [
    "suite-timeline",
    "suite-notifications",
    "suite-activity",
    "suite-files",
    "suite-health",
    "suite-job",
    "suite-costs",
    "suite-time-review",
    "quote-settings",
  ],
};
export function refreshTopics(topics: string[]) {
  const prefixes = topics.flatMap((t) => TOPIC_KEYS[t] || []);
  void queryClient.invalidateQueries({
    predicate: (q) => prefixes.some((p) => String(q.queryKey[0]).startsWith(p)),
  });
}
export function useSuiteSync() {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let generation = 0,
      disposed = false,
      controller: AbortController | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    const versions = new Map<string, number>();
    async function connect() {
      if (disposed || document.hidden || !getAuthToken()) return;
      const current = ++generation;
      clearTimeout(timer);
      controller?.abort();
      controller = new AbortController();
      try {
        const res = await fetch("/api/suite/events", {
          headers: { "X-Auth": getAuthToken()! },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error("Updates unavailable");
        setConnected(true);
        refreshTopics(Object.keys(TOPIC_KEYS));
        const reader = res.body.getReader(),
          decoder = new TextDecoder();
        let buffer = "";
        while (!disposed) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let boundary;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const packet = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (packet.startsWith("data: ")) {
              const rows = JSON.parse(packet.slice(6));
              const changed: string[] = [];
              for (const row of rows) {
                if (
                  versions.has(row.topic) &&
                  versions.get(row.topic) !== row.version
                )
                  changed.push(row.topic);
                versions.set(row.topic, row.version);
              }
              refreshTopics(changed);
            }
          }
        }
      } catch {
      } finally {
        if (!disposed && current === generation) {
          setConnected(false);
          if (!document.hidden) timer = setTimeout(connect, 5000);
        }
      }
    }
    const wake = () => {
      if (document.hidden) controller?.abort();
      else {
        clearTimeout(timer);
        void connect();
      }
    };
    const mutate = (event: Event) => {
      const url = (event as CustomEvent<string>).detail;
      const topics =
        url.includes("/inventory") || url.includes("/items")
          ? ["inventory", "jobs"]
          : url.includes("/finance")
            ? ["finance", "inventory", "jobs"]
            : url.includes("/pm/time")
              ? ["time"]
              : url.includes("/hr")
                ? ["team", "time"]
                : url.includes("/crm") || url.includes("/quotes")
                  ? ["crm", "jobs", "finance"]
                  : ["jobs", "communication"];
      refreshTopics(topics);
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("suite-mutation", mutate);
    void connect();
    return () => {
      disposed = true;
      controller?.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("suite-mutation", mutate);
    };
  }, []);
  return connected;
}
