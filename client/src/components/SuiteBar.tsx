import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useSuiteSync } from "@/lib/suite-sync";
import { useApiMutation } from "@/hooks/useApiMutation";
export default function SuiteBar() {
  const connected = useSuiteSync();
  const timer = useQuery<any>({
    queryKey: ["pm-time-running"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/pm/time/running")).json(),
  });
  const inbox = useQuery<any[]>({
    queryKey: ["suite-notifications"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/suite/notifications")).json(),
  });
  const stop = useApiMutation({
    request: () => ({ method: "POST", url: "/api/pm/time/stop" }),
    errorTitle: "Could not stop timer",
    successTitle: "Work time recorded",
  });
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2 text-sm">
      <Link className="font-medium underline" href="/today?inbox=1">
        Inbox
        {inbox.data?.some((n) => !n.read_at)
          ? ` (${inbox.data.filter((n) => !n.read_at).length})`
          : ""}
      </Link>
      {timer.data && (
        <>
          <Link
            href={
              timer.data.projectId
                ? `/project/${timer.data.projectId}?tab=work`
                : "/pm/time"
            }
          >
            Timer running since{" "}
            {new Date(timer.data.startedAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </Link>
          <button
            className="rounded border px-3 py-1"
            onClick={() => stop.mutate()}
            disabled={stop.isPending}
          >
            Stop work
          </button>
        </>
      )}
      <span className="ml-auto text-xs text-muted-foreground" role="status">
        {connected ? "Live updates" : "Reconnecting updates…"}
      </span>
    </div>
  );
}
