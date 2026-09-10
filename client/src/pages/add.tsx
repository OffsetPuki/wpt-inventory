import { invalidateInventory } from "@/lib/inventory";
import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import { downscaleImage, uploadPhoto } from "@/lib/uploadPhoto";
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
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [identifying, setIdentifying] = useState(false);
  const [seed, setSeed] = useState<ItemFormSeed>({ equipmentType: null, customAttrs: {} });


  const create = useMutation({
    mutationFn: async (payload: Record<string, any>) => {
      const res = await apiRequest("POST", "/api/items", payload);
      return (await res.json()) as Item;
    },
    onSuccess: () => {

      void invalidateInventory(qc);
      toast({variant:"success",title:"Item added"});
    },
    onError: (e: any) =>
      toast({ variant: "destructive", title: "Could not add item", description: e?.message }),
  });

  async function handleIdentify(file: File | null) {
    if (!file) return;
    setIdentifying(true);
    try {
      // Send a downscaled copy to the AI (cheaper); fall back to the original if
      // the browser can't process the image (e.g. some HEIC files). Only the AI
      // copy uses 768px; the saved photo uses the normal inventory size.
      const small = await downscaleImage(file, 768, 0.8).catch(() => file);
      const dataUrl = await fileToDataUrl(small);
      // Strip the data-URL prefix — the AI route accepts raw base64 and it
      // shaves a small amount off every payload.
      const rawBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);

      // Kick off the photo upload in parallel with the AI call so the user
      // doesn't wait for two sequential round-trips. Upload is best-effort.
      const identifyP = apiRequest("POST", "/api/ai/identify-item", { photoBase64: rawBase64 })
        .then((r) => r.json());

      const uploadP: Promise<string | null> = downscaleImage(file).then(uploadPhoto).catch(() => null);

      const [data, photoUrl] = await Promise.all([identifyP, uploadP]);

      setSeed({
        name: data.name ?? "",
        category: data.category ?? "tools",
        notes: data.notes ?? "",
        equipmentType: null,
        customAttrs: {},
        photos: photoUrl ? [photoUrl] : [],
      });

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
        mode="create"
        suggestion={seed}
        submitting={create.isPending}
        onSubmit={async (payload, another) => {const item=await create.mutateAsync(payload);if(!another)setLocation(`/item/${item.id}`);}}
      />
    </div>
  );
}
