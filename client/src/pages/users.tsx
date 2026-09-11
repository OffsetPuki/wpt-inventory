import { Link } from "wouter";
import Modal from "@/components/Modal";
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

// One source of truth for how each role is labelled and badged in the UI.
// Legacy manager/technician rows (pre-collapse) display as Owner.
const asRole = (r: string): Role => (r === "worker" ? "worker" : "owner");
const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  worker: "Worker",
};
const ROLE_ICON: Record<Role, typeof ShieldCheck> = {
  owner: ShieldCheck,
  worker: HardHat,
};
const ROLE_BADGE: Record<Role, string> = {
  owner: "bg-primary/15 text-primary",
  worker: "bg-secondary text-secondary-foreground",
};
const ROLE_HELP: Record<Role, string> = {
  owner: "Everything — dashboard, finance, users, settings.",
  worker: "Shop work, time tracking, projects, customer leads and quotes. Finance, payroll and account settings are owner-only.",
};

const inputCls =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

export default function UsersPage() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [resetUser,setResetUser]=useState<PublicUser|null>(null);
  const [credential,setCredential]=useState("");
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<Role>("worker");

  const { data: users = [], isLoading } = useQuery<PublicUser[]>({
    queryKey: ["users"],
    queryFn: async () => (await apiRequest("GET", "/api/users")).json(),
    refetchInterval: false,
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
    mutationFn: async (user: PublicUser) => apiRequest("PATCH", `/api/users/${user.id}/access`, {active:user.disabledAt!=null}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast({ variant: "success", title: "Access updated" });
    },
    onError: (e: any) => toast({ variant: "destructive", title: "Could not update access", description: e?.message }),
  });

  return (
    <div className="mx-auto max-w-3xl">
      <Header title="Users" description="Who can sign in and what they can do" />
      <Link href="/security" className="mb-4 inline-block underline">My password and devices</Link>
      {resetUser && <Modal open title={`Reset ${resetUser.name}'s sign-in`} onClose={()=>setResetUser(null)}>
        <form className="space-y-4" onSubmit={async e=>{e.preventDefault();try{await apiRequest("POST",`/api/users/${resetUser.id}/reset-credential`,{credential});setResetUser(null);setCredential("");toast({title:"Credential reset. Existing sessions signed out."});if(resetUser.id===me?.id)location.reload();}catch(error:any){toast({variant:"destructive",title:"Could not reset",description:error.message});}}}>
          <p className="text-sm">This signs out existing sessions and preserves their work history.</p>
          <label className="block">{resetUser.role==="worker"?"New PIN (4–12 digits)":"New password (12+ characters)"}<input required className={inputCls} type="password" autoComplete="new-password" value={credential} onChange={e=>setCredential(e.target.value)}/></label>
          <button className="h-11 rounded-lg bg-primary px-4 text-primary-foreground">Reset and sign out sessions</button>
        </form>
      </Modal>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || (role === "owner" ? pin.length < 12 : !/^\d{4,12}$/.test(pin))) {
            toast({ variant: "destructive", title: "Enter a name and a valid password or PIN" });
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
          <span className="text-sm font-medium text-foreground">{role === "owner" ? "Password (12+ characters)" : "PIN (4–12 digits)"}</span>
          <input
            className={inputCls}
            type="password"
            inputMode={role === "worker" ? "numeric" : "text"}
            autoComplete="new-password"
            maxLength={64}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Role</span>
          <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="worker">Worker</option>
            <option value="owner">Owner</option>
          </select>
          <span className="text-xs text-muted-foreground">{ROLE_HELP[role]}</span>
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
                    ROLE_BADGE[asRole(u.role)]
                  )}
                >
                  {(() => {
                    const Icon = ROLE_ICON[asRole(u.role)];
                    return <Icon className="h-5 w-5" />;
                  })()}
                </span>
                <div>
                  <p className="font-semibold text-foreground">{u.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {ROLE_LABELS[asRole(u.role)]} · added {formatDate(u.createdAt as unknown as string)}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
                <span>{u.disabledAt != null ? "Inactive" : "Active"}</span>
                <button className="underline" onClick={()=>{setResetUser(u);setCredential("");}}>Reset {u.role==="worker"?"PIN":"password"}</button>
                {me?.id!==u.id && <button disabled={del.isPending} className="underline" onClick={()=>del.mutate(u)}>{u.disabledAt!=null?"Activate":"Deactivate access"}</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
