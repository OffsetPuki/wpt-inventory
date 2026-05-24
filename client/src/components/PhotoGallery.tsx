import { useRef, useState } from "react";
import { getAuthToken } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { ImagePlus, X, Loader2, ImageOff } from "lucide-react";

async function uploadPhoto(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("photo", file);
  const token = getAuthToken();
  const res = await fetch("/api/upload", {
    method: "POST",
    headers: token ? { "X-Auth": token } : {},
    body: fd,
  });
  if (!res.ok) throw new Error("Upload failed");
  const data = await res.json();
  return data.url as string;
}

interface PhotoGalleryProps {
  photos: string[];
  onChange?: (photos: string[]) => void;
  max?: number;
}

export default function PhotoGallery({ photos, onChange, max = 5 }: PhotoGalleryProps) {
  const editable = typeof onChange === "function";
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [active, setActive] = useState(0);

  async function handleFiles(files: FileList | null) {
    if (!files || !onChange) return;
    const remaining = max - photos.length;
    const toUpload = Array.from(files).slice(0, remaining);
    if (toUpload.length === 0) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const f of toUpload) urls.push(await uploadPhoto(f));
      onChange([...photos, ...urls]);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Upload failed", description: e?.message });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // ── Editable grid ──
  if (editable) {
    return (
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {photos.map((url, i) => (
          <div
            key={url + i}
            className="group relative aspect-square overflow-hidden rounded-xl border border-border bg-muted"
          >
            <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => onChange!(photos.filter((_, idx) => idx !== i))}
              className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
              aria-label="Remove photo"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        {photos.length < max && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
          >
            {uploading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <>
                <ImagePlus className="h-6 w-6" />
                <span className="text-xs">Add</span>
              </>
            )}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
    );
  }

  // ── Display mode ──
  if (photos.length === 0) {
    return (
      <div className="flex aspect-video w-full items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
        <ImageOff className="h-10 w-10" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="aspect-video w-full overflow-hidden rounded-xl border border-border bg-muted">
        <img
          src={photos[active]}
          alt="Item"
          className="h-full w-full object-contain"
        />
      </div>
      {photos.length > 1 && (
        <div className="flex gap-2 overflow-x-auto">
          {photos.map((url, i) => (
            <button
              key={url + i}
              onClick={() => setActive(i)}
              className={cn(
                "h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition-colors",
                i === active ? "border-primary" : "border-transparent opacity-70"
              )}
            >
              <img src={url} alt={`Thumb ${i + 1}`} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
