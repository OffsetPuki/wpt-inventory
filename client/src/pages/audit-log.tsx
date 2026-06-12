import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { formatDateTime } from "@/lib/format";
import Header from "@/components/Header";
import { Loader2, Shield } from "lucide-react";

interface AuditEntry {
  id: number;
  userId: number | null;
  userName: string | null;
  role: string | null;
  action: string;
  targetType: string | null;
  targetId: number | null;
  targetName: string | null;
  ip: string | null;
  details: string | null;
  createdAt: number;
}

// Short, human-friendly label for each action — falls back to the raw key
// (e.g. "settings.update") if we don't have a mapping yet.
const ACTION_LABEL: Record<string, string> = {
  "auth.login_success": "Signed in",
  "auth.login_fail": "Failed sign-in",
  "auth.logout": "Signed out",
  "user.create": "Created user",
  "user.delete": "Deleted user",
  "item.create": "Added item",
  "item.delete": "Deleted item",
  "item.restore": "Restored item",
  "item.adjust": "Adjusted stock",
  "project.create": "Created project",
  "project.delete": "Deleted project",
  "project.restore": "Restored project",
  "project.status_change": "Changed project status",
  "settings.update": "Updated settings",
};

// Tag colors hint at the action category without overwhelming the grid.
function tagClass(action: string): string {
  if (action.startsWith("auth.login_fail")) return "bg-destructive/15 text-destructive";
  if (action.endsWith(".delete")) return "bg-destructive/15 text-destructive";
  if (action.endsWith(".restore")) return "bg-emerald-500/15 text-emerald-500";
  if (action.startsWith("auth.")) return "bg-secondary text-secondary-foreground";
  return "bg-primary/15 text-primary";
}

const ACTION_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "All actions" },
  { value: "auth.login_fail", label: "Failed sign-ins" },
  { value: "auth.login_success", label: "Sign-ins" },
  { value: "item.delete", label: "Item deletes" },
  { value: "project.delete", label: "Project deletes" },
  { value: "user.create", label: "User added" },
  { value: "user.delete", label: "User removed" },
  { value: "settings.update", label: "Settings changes" },
];

export default function AuditLogPage() {
  const [actionFilter, setActionFilter] = useState("");

  const { data: entries = [], isLoading } = useQuery<AuditEntry[]>({
    queryKey: ["audit-log", actionFilter],
    queryFn: async () => {
      const qs = actionFilter ? `?action=${encodeURIComponent(actionFilter)}&limit=200` : "?limit=200";
      const res = await apiRequest("GET", `/api/audit-log${qs}`);
      return res.json();
    },
    // Audit data is append-only and historical — no value in polling. The
    // manager can refresh manually if they want the latest entries.
    refetchInterval: false,
  });

  return (
    <div className="mx-auto max-w-5xl">
      <Header
        title="Audit log"
        description="Who did what, when, and from where. The trail that keeps everyone honest."
      >
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="h-11 rounded-xl border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary"
        >
          {ACTION_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </Header>

      {isLoading ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-12 text-muted-foreground">
          <Shield className="h-10 w-10" />
          <p className="text-base">No entries match this filter yet.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((e) => {
            let details: any = null;
            if (e.details) {
              try { details = JSON.parse(e.details); } catch { /* ignore */ }
            }
            return (
              <li
                key={e.id}
                className="flex flex-col gap-1 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:gap-3"
              >
                <span className={`inline-flex w-fit shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium ${tagClass(e.action)}`}>
                  {ACTION_LABEL[e.action] ?? e.action}
                </span>
                <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 text-sm">
                  <span className="font-medium text-foreground">{e.userName ?? "(deleted user)"}</span>
                  {e.targetName && (
                    <span className="text-muted-foreground">
                      → <span className="text-foreground">{e.targetName}</span>
                    </span>
                  )}
                  {details && Object.keys(details).length > 0 && (
                    <span className="truncate text-xs text-muted-foreground">
                      {Object.entries(details)
                        .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
                        .join(" · ")}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                  {e.ip && <span className="font-mono">{e.ip}</span>}
                  <span>{formatDateTime(e.createdAt)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
