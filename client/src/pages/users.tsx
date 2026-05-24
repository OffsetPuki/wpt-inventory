import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import type { PublicUser, Role } from "@shared/schema";
import { formatDate } from "@/lib/format";
import Header from "@/components/Header";
import { cn } from "@/lib/utils";
import { UserPlus, Trash2, Loader2, ShieldCheck, HardHat } from "lucide-react";

const inputCls =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

export default function UsersPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<Role>("worker");

  const { data: users = [], isLoading } = useQuery<PublicUser[]>({
    queryKey: ["users"],
    queryFn: async () => (await apiRequest("GET", "/api/users")).json(),
  });

  const create = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/users", { name: name.trim(), pin, role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setName("");
      setPin("");
      setRole("worker");
      toast({ variant: "success", title: "User added" });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Could not add", description: e?.message }),
  });

  const del = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast({ variant: "success", title: "User removed" });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Could not remove", description: e?.message }),
  });

  return (
    <div className="mx-auto max-w-3xl">
      <Header title="Users" description="Who can sign in and what they can do" />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || pin.length !== 4) {
            toast({ variant: "destructive", title: "Enter a name and 4-digit PIN" });
            return;
          }
          create.mutate();
        }}
        className="mb-6 grid items-end gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[1fr_120px_140px_auto]"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Name</span>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">PIN</span>
          <input
            className={inputCls}
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Role</span>
          <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="worker">Worker</option>
            <option value="manager">Manager</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={create.isPending}
          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {create.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <UserPlus className="h-5 w-5" />}
          Add
        </button>
      </form>

      {isLoading ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {users.map((u) => (
            <li
              key={u.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full",
                    u.role === "manager" ? "bg-primary/15 text-primary" : "bg-secondary text-secondary-foreground"
                  )}
                >
                  {u.role === "manager" ? <ShieldCheck className="h-5 w-5" /> : <HardHat className="h-5 w-5" />}
                </span>
                <div>
                  <p className="font-semibold text-foreground">{u.name}</p>
                  <p className="text-xs capitalize text-muted-foreground">
                    {u.role} · added {formatDate(u.createdAt as unknown as string)}
                  </p>
                </div>
              </div>
              {me?.id !== u.id && (
                <button
                  onClick={() => del.mutate(u.id)}
                  className="text-muted-foreground transition-colors hover:text-destructive"
                  aria-label="Remove user"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
