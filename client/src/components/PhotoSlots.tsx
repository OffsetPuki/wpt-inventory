import { useRef, useState } from "react";
import { getAuthToken } from "@/lib/queryClient";
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
  return (await res.json()).url as string;
}

// Resize a phone-sized photo (5-10 MB) to ~1600px JPEG before upload — typically
// 5-10x smaller payload with no visible quality loss for inventory shots.
function downscaleImage(file: File, maxDim = 1600, quality = 0.85): Promise<File> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      // Already small enough and already JPEG — skip re-encoding.
      if (scale === 1 && /^image\/jpe?g$/i.test(file.type)) return resolve(file);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas unsupported"));
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          if (!blob) return reject(new Error("Encode failed"));
          const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
          resolve(new File([blob], name, { type: "image/jpeg" }));
        },
        "image/jpeg",
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image load failed"));
    };
    img.src = url;
  });
}

/**
 * Five fixed, labelled photo slots that guide the worker to capture the same
 * shots every time. `photos` is positional (index 0 = main); empty slots hold "".
 */
export default function PhotoSlots({
  photos,
  onChange,
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
}) {
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  function padded(): string[] {
    const a = [...photos];
    while (a.length < SLOTS.length) a.push("");
    return a;
  }

  async function handleFile(idx: number, file: File | null) {
    if (!file) return;
    setUploadingIdx(idx);
    try {
      // Shrink before upload (huge speedup); fall back to the original on any error
      // (e.g. some HEIC files that the browser can't decode into a canvas).
      let toUpload: File = file;
      try {
        toUpload = await downscaleImage(file);
      } catch {
        /* keep original */
      }
      const url = await uploadPhoto(toUpload);
      const next = padded();
      next[idx] = url;
      onChange(next);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Upload failed", description: e?.message });
    } finally {
      setUploadingIdx(null);
      const input = refs.current[idx];
      if (input) input.value = "";
    }
  }

  function remove(idx: number) {
    const next = padded();
    next[idx] = "";
    onChange(next);
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {SLOTS.map((slot, i) => {
        const url = photos[i];
        return (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="relative aspect-square">
              {url ? (
                <div className="h-full w-full overflow-hidden rounded-xl border border-border bg-muted">
                  <img src={url} alt={slot.label} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white"
                    aria-label={`Remove ${slot.label}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => refs.current[i]?.click()}
                  disabled={uploadingIdx === i}
                  className={cn(
                    "flex h-full w-full flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60"
                  )}
                >
                  {uploadingIdx === i ? (
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
