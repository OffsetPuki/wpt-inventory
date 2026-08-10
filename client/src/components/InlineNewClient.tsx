import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import { inputCls } from "@/lib/ui-styles";
import { cn } from "@/lib/utils";
import { Loader2, Plus } from "lucide-react";
import type { Client } from "@shared/crm-schema";

/**
 * Inline "+ New client" — creates a CRM client from just a name (+ optional
 * phone) without leaving the form, so pickers never force a detour to the
 * Clients page. The caller selects the new row via onCreated.
 */
export default function InlineNewClient({ onCreated }: { onCreated: (c: Client) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!name.trim()) {
      toast({ variant: "destructive", title: "Client name is required" });
      return;
    }
    setSaving(true);
    try {
      const row: Client = await (
        await apiRequest("POST", "/api/crm/clients", {
          name: name.trim(),
          phone: phone.trim() || undefined,
        })
      ).json();
      // Every client picker in the app keys off one of these.
      qc.invalidateQueries({ queryKey: ["crm-clients"] });
      qc.invalidateQueries({ queryKey: ["crm-clients-picker"] });
      setOpen(false);
      setName("");
      setPhone("");
      onCreated(row);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not create client", description: e?.message });
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline"
      >
        <Plus className="h-4 w-4" />
        New client
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        className={cn(inputCls, "h-10 w-40 flex-1 text-sm")}
        placeholder="Client name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
      />
      <input
        className={cn(inputCls, "h-10 w-36 text-sm")}
        placeholder="Phone (optional)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <button
        type="button"
        onClick={create}
        disabled={saving}
        className="flex h-10 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
      >
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        Add
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="h-10 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground"
      >
        Cancel
      </button>
    </div>
  );
}
