import { useRef, useState } from "react";
import { getAuthToken } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { ImagePlus, X, Loader2, ImageOff, ChevronLeft, ChevronRight } from "lucide-react";

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [uploading, setUploading] = useState(false);
  const [active, setActive] = useState(0);

  function go(i: number) {
    const el = scrollRef.current;
    if (!el) return;
    const clamped = Math.max(0, Math.min(photos.length - 1, i));
    el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" });
  }
  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    if (idx !== active) setActive(idx);
  }

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
      <div className="flex aspect-square w-full items-center justify-center rounded-xl border border-border bg-muted text-muted-foreground">
        <ImageOff className="h-10 w-10" />
      </div>
    );
  }

  const multiple = photos.length > 1;

  return (
    <div className="group relative w-full overflow-hidden rounded-xl border border-border bg-black">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex aspect-square w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {photos.map((url, i) => (
          <div key={url + i} className="relative h-full w-full shrink-0 snap-center overflow-hidden">
            {/* Blurred fill so off-ratio photos have no flat letterbox background. */}
            <img
              src={url}
              alt=""
              aria-hidden
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl"
            />
            <img
              src={url}
              alt={`Photo ${i + 1}`}
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
              className="relative z-10 h-full w-full object-contain"
            />
          </div>
        ))}
      </div>

      {multiple && (
        <>
          <button
            onClick={() => go(active - 1)}
            disabled={active === 0}
            aria-label="Previous photo"
            className="absolute left-2 top-1/2 z-20 hidden -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/70 disabled:opacity-0 group-hover:opacity-100 sm:block"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => go(active + 1)}
            disabled={active === photos.length - 1}
            aria-label="Next photo"
            className="absolute right-2 top-1/2 z-20 hidden -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/70 disabled:opacity-0 group-hover:opacity-100 sm:block"
          >
            <ChevronRight className="h-5 w-5" />
          </button>

          <div className="absolute inset-x-0 bottom-3 z-20 flex justify-center gap-1.5">
            {photos.map((_, i) => (
              <button
                key={i}
                onClick={() => go(i)}
                aria-label={`Go to photo ${i + 1}`}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === active ? "w-4 bg-white" : "w-1.5 bg-white/50 hover:bg-white/80"
                )}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
