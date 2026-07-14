import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { ImageOff, ChevronLeft, ChevronRight } from "lucide-react";

interface PhotoGalleryProps {
  photos: string[];
}

export default function PhotoGallery({ photos }: PhotoGalleryProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
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
