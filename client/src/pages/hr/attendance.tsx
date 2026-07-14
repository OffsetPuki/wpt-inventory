import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useApiMutation } from "@/hooks/useApiMutation";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import { LoadingBlock, EmptyState } from "@/components/ui/Feedback";
import { Chip } from "@/components/ui/Chip";
import { inputCls } from "@/lib/ui-styles";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, formatHours } from "@/lib/format";
import type { AttendanceRow, Employee } from "@shared/hr-schema";
import { Loader2, Clock, LogIn, LogOut, MapPin, Pencil, Trash2, Info } from "lucide-react";

type MineResponse = { open: AttendanceRow | null; rows: AttendanceRow[] };
type TeamRow = AttendanceRow & { employeeName: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Best-effort GPS fix: resolves null on deny/failure/timeout (~5s). */
function getPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    let done = false;
    const finish = (v: { lat: number; lng: number } | null) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const timer = setTimeout(() => finish(null), 5000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        finish({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        finish(null);
      },
      { timeout: 5000, maximumAge: 60_000 }
    );
  });
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${h}:${p(m)}:${p(s)}`;
}

function shiftMinutes(row: AttendanceRow): number {
  if (!row.clockOut) return 0;
  return Math.max(0, Math.round((row.clockOut - row.clockIn) / 60_000));
}

function PinLink({ lat, lng, label }: { lat: number | null; lng: number | null; label: string }) {
  if (lat == null || lng == null) return null;
  return (
    <a
      href={`https://maps.google.com/?q=${lat},${lng}`}
      target="_blank"
      rel="noreferrer"
      title={label}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex text-muted-foreground transition-colors hover:text-primary"
    >
      <MapPin className="h-4 w-4" />
    </a>
  );
}

/** Convert unix ms to a value for <input type="datetime-local">. */
function toLocalInput(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ─── Self-service clock card ──────────────────────────────────────────────────

function ClockCard() {
  const qc = useQueryClient();
  const [now, setNow] = useState(Date.now());

  const { data: me, isLoading: meLoading } = useQuery<Employee | null>({
    queryKey: ["hr-me"],
    queryFn: async () => (await apiRequest("GET", "/api/hr/me")).json(),
  });

  const { data: mine, isLoading: mineLoading } = useQuery<MineResponse>({
    queryKey: ["hr-attendance-mine"],
    queryFn: async () => (await apiRequest("GET", "/api/hr/attendance/mine")).json(),
    enabled: !!me,
  });

  const openShift = mine?.open ?? null;

  useEffect(() => {
    if (!openShift) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [openShift?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const clock = useMutation({
    mutationFn: async (action: "clock-in" | "clock-out") => {
      const coords = await getPosition();
      if (!coords) {
        toast({
          title: "No location this time",
          description: "Recording your shift without GPS coordinates.",
        });
      }
      return (await apiRequest("POST", `/api/hr/attendance/${action}`, coords ?? {})).json();
    },
    onSuccess: (_data, action) => {
      qc.invalidateQueries({ queryKey: ["hr-attendance-mine"] });
      qc.invalidateQueries({ queryKey: ["hr-attendance"] });
      toast({
        variant: "success",
        title: action === "clock-in" ? "Clocked in" : "Clocked out",
      });
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Clock action failed", description: e?.message }),
  });

  if (meLoading) {
    return (
      <div className="flex justify-center rounded-xl border border-border bg-card p-8 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!me) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
        <Info className="h-5 w-5 shrink-0" />
        <p>
          No employee profile is linked to your account, so self-service clock in/out is
          unavailable. Ask a manager to link your login on the Employees page.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {openShift ? "On the clock since" : "You are off the clock"}
          </p>
          {openShift ? (
            <div className="mt-1 flex items-baseline gap-3">
              <p className="text-foreground">{formatDateTime(openShift.clockIn)}</p>
              <p className="text-2xl font-semibold tabular-nums text-foreground">
                {formatElapsed(now - openShift.clockIn)}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-2xl font-semibold text-foreground">
              {me.firstName}, ready when you are
            </p>
          )}
        </div>
        <button
          onClick={() => clock.mutate(openShift ? "clock-out" : "clock-in")}
          disabled={clock.isPending || mineLoading}
          className={cn(
            "flex h-14 items-center justify-center gap-2 rounded-xl px-8 text-lg font-semibold disabled:opacity-60",
            openShift
              ? "border border-red-500/40 text-red-600 hover:border-red-500 dark:text-red-400"
              : "bg-primary text-primary-foreground hover:opacity-90"
          )}
        >
          {clock.isPending ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : openShift ? (
            <LogOut className="h-5 w-5" />
          ) : (
            <LogIn className="h-5 w-5" />
          )}
          {openShift ? "Clock out" : "Clock in"}
        </button>
      </div>

      <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        My recent shifts
      </h3>
      {mineLoading ? (
        <div className="flex justify-center py-6 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (mine?.rows.length ?? 0) === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">No shifts yet — clock in to start one.</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {mine!.rows.slice(0, 10).map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2.5">
              <span className="w-24 shrink-0 text-foreground">{formatDate(r.clockIn)}</span>
              <span className="flex-1 text-muted-foreground">
                {formatTime(r.clockIn)} → {r.clockOut ? formatTime(r.clockOut) : "…"}
              </span>
              <PinLink lat={r.clockInLat} lng={r.clockInLng} label="Clock-in location" />
              <PinLink lat={r.clockOutLat} lng={r.clockOutLng} label="Clock-out location" />
              {r.clockOut ? (
                <span className="w-16 shrink-0 text-right tabular-nums text-foreground">
                  {formatHours(shiftMinutes(r))}
                </span>
              ) : (
                <Chip tone="amber">Open</Chip>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Team view (elevated) ─────────────────────────────────────────────────────

function EditShiftDialog({ row, onClose }: { row: TeamRow; onClose: () => void }) {
  const [clockIn, setClockIn] = useState(toLocalInput(row.clockIn));
  const [clockOut, setClockOut] = useState(toLocalInput(row.clockOut));
  const [notes, setNotes] = useState(row.notes ?? "");

  const save = useApiMutation({
    request: () => ({
      method: "PATCH",
      url: `/api/hr/attendance/${row.id}`,
      body: {
        clockIn: new Date(clockIn).getTime(),
        clockOut: clockOut ? new Date(clockOut).getTime() : null,
        notes: notes.trim() || null,
      },
    }),
    invalidate: [["hr-attendance"], ["hr-attendance-mine"]],
    successTitle: "Shift updated",
    errorTitle: "Could not update shift",
    onSuccess: onClose,
  });

  const del = useApiMutation({
    request: () => ({ method: "DELETE", url: `/api/hr/attendance/${row.id}` }),
    invalidate: [["hr-attendance"], ["hr-attendance-mine"]],
    successTitle: "Shift deleted",
    errorTitle: "Could not delete shift",
    onSuccess: onClose,
  });

  return (
    <Modal open onClose={onClose} title={`Edit shift — ${row.employeeName}`}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!clockIn) {
            toast({ variant: "destructive", title: "Clock-in time is required" });
            return;
          }
          if (clockOut && new Date(clockOut).getTime() < new Date(clockIn).getTime()) {
            toast({ variant: "destructive", title: "Clock-out must be after clock-in" });
            return;
          }
          save.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Clock in</span>
          <input
            type="datetime-local"
            className={inputCls}
            value={clockIn}
            onChange={(e) => setClockIn(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Clock out</span>
          <input
            type="datetime-local"
            className={inputCls}
            value={clockOut}
            onChange={(e) => setClockOut(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">Leave empty to keep the shift open.</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Notes</span>
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div className="mt-1 flex gap-2">
          <button
            type="submit"
            disabled={save.isPending}
            className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {save.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
            Save correction
          </button>
          <button
            type="button"
            disabled={del.isPending}
            onClick={() => {
              if (window.confirm("Delete this attendance record?")) del.mutate();
            }}
            className="flex h-11 items-center gap-2 rounded-xl border border-border px-4 font-medium text-red-600 hover:border-red-500 disabled:opacity-60 dark:text-red-400"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TeamSection() {
  const [employeeId, setEmployeeId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [editing, setEditing] = useState<TeamRow | null>(null);

  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ["hr-employees"],
    queryFn: async () => (await apiRequest("GET", "/api/hr/employees")).json(),
  });

  const { data: rows = [], isLoading } = useQuery<TeamRow[]>({
    queryKey: ["hr-attendance", employeeId, from, to],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (employeeId) params.set("employeeId", employeeId);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const qs = params.toString();
      return (await apiRequest("GET", `/api/hr/attendance${qs ? `?${qs}` : ""}`)).json();
    },
  });

  return (
    <section className="mt-10">
      <h2 className="mb-1 text-lg font-semibold text-foreground">Team attendance</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        All recorded shifts — open shifts are highlighted; click the pencil to correct a record.
      </p>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <select
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          className={cn(inputCls, "sm:w-56")}
        >
          <option value="">All employees</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.firstName} {e.lastName}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          From
          <input
            type="date"
            className={cn(inputCls, "w-auto")}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          To
          <input
            type="date"
            className={cn(inputCls, "w-auto")}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState icon={Clock} message="No shifts recorded for this filter" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3 font-medium">Employee</th>
                <th className="px-4 py-3 font-medium">Clock in</th>
                <th className="px-4 py-3 font-medium">Clock out</th>
                <th className="px-4 py-3 text-right font-medium">Duration</th>
                <th className="px-4 py-3 font-medium">GPS</th>
                <th className="px-4 py-3 font-medium">Notes</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className={cn(!r.clockOut && "bg-amber-500/5")}>
                  <td className="px-4 py-3 font-medium text-foreground">{r.employeeName}</td>
                  <td className="px-4 py-3 text-foreground">{formatDateTime(r.clockIn)}</td>
                  <td className="px-4 py-3">
                    {r.clockOut ? (
                      <span className="text-foreground">{formatDateTime(r.clockOut)}</span>
                    ) : (
                      <Chip tone="amber">Open</Chip>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">
                    {r.clockOut ? formatHours(shiftMinutes(r)) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5">
                      <PinLink lat={r.clockInLat} lng={r.clockInLng} label="Clock-in location" />
                      <PinLink lat={r.clockOutLat} lng={r.clockOutLng} label="Clock-out location" />
                    </span>
                  </td>
                  <td className="max-w-[16rem] truncate px-4 py-3 text-muted-foreground">
                    {r.notes ?? ""}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setEditing(r)}
                      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      aria-label="Edit shift"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && <EditShiftDialog row={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HrAttendancePage() {
  const { isElevated } = useAuth();

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Attendance" description="Clock in and out, and review shifts" />
      <ClockCard />
      {isElevated && <TeamSection />}
    </div>
  );
}
