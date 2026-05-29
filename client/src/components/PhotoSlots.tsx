import { useEffect, useRef, useState } from "react";
import { downscaleImage, uploadPhoto } from "@/lib/uploadPhoto";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { Camera, X, Loader2 } from "lucide-react";

const SLOTS = [
  { label: "Main photo", hint: "The whole item" },
  { label: "Label close-up", hint: "Part # / specs" },
  { label: "Where it lives", hint: "Rack / spot" },
  { label: "Side view", hint: "Another angle" },
  { label: "In use", hint: "Optional" },
];

/**
 * Five fixed, labelled photo slots that guide the worker to capture the same
 * shots every time. `photos` is positional (index 0 = main); empty slots hold "".
 *
 * Uploads run in the background: the slot fills with a local preview the
 * instant the file is picked, so the user can immediately move on to the next
 * slot. Multiple slots can upload in parallel.
 */
export default function PhotoSlots({
  photos,
  onChange,
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
}) {
  const [uploading, setUploading] = useState<Set<number>>(new Set());
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  // Local blob-URL previews shown while the real upload is in flight. Kept
  // outside `photos` so the server never receives a blob: URL on submit.
  const localUrls = useRef<Map<number, string>>(new Map());

  // Latest photos array, so concurrent uploads don't clobber each other when
  // the previous render's value is stale.
  const photosRef = useRef(photos);
  photosRef.current = photos;

  useEffect(() => {
    return () => {
      for (const u of localUrls.current.values()) URL.revokeObjectURL(u);
      localUrls.current.clear();
    };
  }, []);

  function padded(src: string[]): string[] {
    const a = [...src];
    while (a.length < SLOTS.length) a.push("");
    return a;
  }

  function setSlot(idx: number, url: string) {
    const next = padded(photosRef.current);
    next[idx] = url;
    onChange(next);
  }

  async function handleFile(idx: number, file: File | null) {
    if (!file) return;
    setUploading((prev) => new Set(prev).add(idx));
    try {
      // Shrink before upload (huge speedup); fall back to the original on any
      // error (e.g. some HEIC files the browser can't decode into a canvas).
      let toUpload: File = file;
      try {
        toUpload = await downscaleImage(file);
      } catch {
        /* keep original */
      }

      // Optimistic local preview: render the picked photo instantly so the
      // user can move to the next slot without waiting for the network.
      const old = localUrls.current.get(idx);
      if (old) URL.revokeObjectURL(old);
      const local = URL.createObjectURL(toUpload);
      localUrls.current.set(idx, local);
      // Trigger a re-render so the preview shows immediately.
      setUploading((prev) => new Set(prev));

      const url = await uploadPhoto(toUpload);
      setSlot(idx, url);
      URL.revokeObjectURL(local);
      localUrls.current.delete(idx);
    } catch (e: any) {
      const old = localUrls.current.get(idx);
      if (old) {
        URL.revokeObjectURL(old);
        localUrls.current.delete(idx);
      }
      toast({ variant: "destructive", title: "Upload failed", description: e?.message });
    } finally {
      setUploading((prev) => {
        const n = new Set(prev);
        n.delete(idx);
        return n;
      });
      const input = refs.current[idx];
      if (input) input.value = "";
    }
  }

  function remove(idx: number) {
    const old = localUrls.current.get(idx);
    if (old) {
      URL.revokeObjectURL(old);
      localUrls.current.delete(idx);
    }
    const next = padded(photosRef.current);
    next[idx] = "";
    onChange(next);
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {SLOTS.map((slot, i) => {
        const serverUrl = photos[i];
        const previewUrl = serverUrl || localUrls.current.get(i) || "";
        const isUploading = uploading.has(i);
        return (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="relative aspect-square">
              {previewUrl ? (
                <div className="h-full w-full overflow-hidden rounded-xl border border-border bg-muted">
                  <img
                    src={previewUrl}
                    alt={slot.label}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                  {isUploading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <Loader2 className="h-6 w-6 animate-spin text-white" />
                    </div>
                  )}
                  {!isUploading && (
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white"
                      aria-label={`Remove ${slot.label}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => refs.current[i]?.click()}
                  disabled={isUploading}
                  className={cn(
                    "flex h-full w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
                  )}
                >
                  {isUploading ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <Camera className="h-6 w-6" />
                  )}
                </button>
              )}
              <input
                ref={(el) => (refs.current[i] = el)}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => handleFile(i, e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="text-center leading-tight">
              <p className="text-xs font-medium text-foreground">{slot.label}</p>
              <p className="text-[10px] text-muted-foreground">{slot.hint}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
