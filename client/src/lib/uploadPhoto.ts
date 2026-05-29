import { getAuthToken } from "@/lib/queryClient";

// Phone photos are 5–10 MB and 12+ MP. Resizing to ~1280px JPEG at q=0.78
// produces ~150–280 KB — about half the size of the previous 1600/0.85 settings
// and still sharp enough to read a part label.
const MAX_DIM = 1280;
const QUALITY = 0.78;

interface Decoded {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  close: () => void;
}

// Off-main-thread decode via createImageBitmap when supported (most modern
// mobile browsers). Falls back to <img> for HEIC or older browsers.
async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      return {
        width: bmp.width,
        height: bmp.height,
        draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h),
        close: () => bmp.close(),
      };
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("Image decode failed"));
    im.src = url;
  });
  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
    close: () => URL.revokeObjectURL(url),
  };
}

export async function downscaleImage(
  file: File,
  maxDim = MAX_DIM,
  quality = QUALITY,
): Promise<File> {
  const decoded = await decode(file);
  try {
    const scale = Math.min(1, maxDim / Math.max(decoded.width, decoded.height));
    // Already small enough and already JPEG — skip re-encoding.
    if (scale === 1 && /^image\/jpe?g$/i.test(file.type)) return file;
    const w = Math.round(decoded.width * scale);
    const h = Math.round(decoded.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    decoded.draw(ctx, w, h);
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob(res, "image/jpeg", quality),
    );
    if (!blob) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } finally {
    decoded.close();
  }
}

export async function uploadPhoto(file: File): Promise<string> {
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

// Convenience: shrink then upload. Falls back to the original file if the
// shrink step throws (e.g. HEIC the browser can't decode into a canvas).
export async function shrinkAndUpload(file: File): Promise<string> {
  let toUpload: File = file;
  try {
    toUpload = await downscaleImage(file);
  } catch {
    /* keep original */
  }
  return uploadPhoto(toUpload);
}
