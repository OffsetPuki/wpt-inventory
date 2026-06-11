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

// Downscale to a small JPEG before sending to the AI — fewer image tokens = lower
// cost. Only the AI copy is shrunk; the photo stored on the item stays full-res.
function downscaleToDataUrl(file: File, maxDim = 768, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas unsupported"));
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed"));
    };
    img.src = url;
  });
}

export default function AddItemPage() {
  const [, setLocation] = useLocation();
  const { isTechnician } = useAuth();
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
      // Technicians land on the edit screen to fine-tune location/details right away.
      setLocation(isTechnician ? `/item/${item.id}/edit` : `/item/${item.id}`);
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not add item", description: e?.message }),
  });

  async function handleIdentify(file: File | null) {
    if (!file) return;
    setIdentifying(true);
    try {
      // Send a downscaled copy to the AI (cheaper); fall back to the original if
      // the browser can't process the image (e.g. some HEIC files).
      let photoBase64: string;
      try {
        photoBase64 = await downscaleToDataUrl(file);
      } catch {
        photoBase64 = await fileToDataUrl(file);
      }
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
