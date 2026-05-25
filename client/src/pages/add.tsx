import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getAuthToken } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import type { Item } from "@shared/schema";
import Header from "@/components/Header";
import ItemForm, { type ItemFormSeed } from "@/components/ItemForm";
import { Camera, Loader2 } from "lucide-react";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function AddItemPage() {
  const [, setLocation] = useLocation();
  const { isManager } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [identifying, setIdentifying] = useState(false);
  const [seed, setSeed] = useState<ItemFormSeed>({ equipmentType: null, customAttrs: {} });
  const [formKey, setFormKey] = useState(0);

  const create = useMutation({
    mutationFn: async (payload: Record<string, any>) => {
      const res = await apiRequest("POST", "/api/items", payload);
      return (await res.json()) as Item;
    },
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: ["items"] });
      toast({ variant: "success", title: "Item added" });
      // Managers land on the edit screen to fine-tune location/details right away.
      setLocation(isManager ? `/item/${item.id}/edit` : `/item/${item.id}`);
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not add item", description: e?.message }),
  });

  async function handleIdentify(file: File | null) {
    if (!file) return;
    setIdentifying(true);
    try {
      const photoBase64 = await fileToDataUrl(file);
      const res = await apiRequest("POST", "/api/ai/identify-item", { photoBase64 });
      const data = await res.json();

      // Also upload the photo so it's attached to the new item.
      let photoUrl: string | null = null;
      try {
        const fd = new FormData();
        fd.append("photo", file);
        const token = getAuthToken();
        const up = await fetch("/api/upload", {
          method: "POST",
          headers: token ? { "X-Auth": token } : {},
          body: fd,
        });
        if (up.ok) photoUrl = (await up.json()).url;
      } catch {
        /* photo upload is best-effort */
      }

      setSeed({
        name: data.name ?? "",
        category: data.category ?? "tools",
        notes: data.notes ?? "",
        equipmentType: null,
        customAttrs: {},
        photos: photoUrl ? [photoUrl] : [],
      });
      setFormKey((k) => k + 1);
      toast({ variant: "success", title: "Prefilled from photo", description: "Review and save." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Identify failed", description: e?.message });
    } finally {
      setIdentifying(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Header title="Add Item" description="Create a new inventory item">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={identifying}
          className="flex h-11 items-center gap-2 rounded-xl border border-border px-5 font-medium text-foreground transition-colors hover:border-primary disabled:opacity-60"
        >
          {identifying ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Camera className="h-5 w-5" />
          )}
          Identify by photo
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => handleIdentify(e.target.files?.[0] ?? null)}
        />
      </Header>

      <ItemForm
        key={formKey}
        mode="create"
        initial={seed}
        submitting={create.isPending}
        onSubmit={(payload) => create.mutate(payload)}
      />
    </div>
  );
}
