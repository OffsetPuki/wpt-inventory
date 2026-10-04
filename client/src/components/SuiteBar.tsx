import {useSaveStatus} from "@/lib/save-status";
import {useEffect,useState} from "react";
import {useLocation} from "wouter";
import {BUSINESSES} from "@shared/business.js";
import {useBusiness,setBusiness} from "@/hooks/useBusiness";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useSuiteSync } from "@/lib/suite-sync";
import { useApiMutation } from "@/hooks/useApiMutation";
export default function SuiteBar() {
  const business=useBusiness(),[route]=useLocation(),saveStatus=useSaveStatus();
  const [online,setOnline]=useState(navigator.onLine);
  useEffect(()=>{const update=()=>setOnline(navigator.onLine);window.addEventListener('online',update);window.addEventListener('offline',update);return()=>{window.removeEventListener('online',update);window.removeEventListener('offline',update);};},[]);
  const shared=/^\/(crm\/clients|pm\/contracts|pm\/documents|hr|home|items|map|settings|security)/.test(route);
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
    <div className="suite-statusbar flex min-h-12 flex-wrap items-center gap-3 border-b border-border bg-card/50 px-4 py-2 text-sm">
      <label className="flex items-center gap-2 text-xs"><span className="sr-only">Business</span><select aria-label="Business" value={business} onChange={e=>setBusiness(e.target.value)} className="min-h-11 max-w-40 rounded-lg border border-border bg-background px-2"><option value="all">All businesses</option>{Object.entries(BUSINESSES).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
      {shared&&<span className="text-xs text-muted-foreground">Shared across all businesses</span>}
      <Link className="rounded-lg px-2 py-1.5 font-medium hover:bg-accent" href="/today?inbox=1">
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
            className="min-h-11 rounded-lg border px-3 py-1 font-medium hover:bg-accent"
            onClick={() => stop.mutate()}
            disabled={stop.isPending}
          >
            Stop work
          </button>
        </>
      )}
      <span className="ml-auto text-xs text-muted-foreground" role="status">
        <span className={connected?"suite-sync-dot":"suite-sync-dot disconnected"} aria-hidden="true" />{!online?'Offline · drafts stay on this device':saveStatus==='Saving…'?'Saving…':saveStatus==='Retry needed'?'Retry needed · reopen the form to retry':connected?'Saved · live updates':'Reconnecting · checking for updates'}
      </span>
    </div>
  );
}
