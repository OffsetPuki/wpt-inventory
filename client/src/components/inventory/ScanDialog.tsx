import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import Modal from "../Modal";
import { inputCls, primaryBtn, secondaryBtn } from "@/lib/ui-styles";

export default function ScanDialog({ onClose }: { onClose: () => void }) {
  const [, navigate] = useLocation();
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    stopped = useRef(false);
  const [error, setError] = useState(""),
    [value, setValue] = useState(""),
    [running, setRunning] = useState(false);
  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(
    () => () => {
      stopped.current = true;
      stop();
    },
    [],
  );
  function open(value: string) {
    let id = value.trim();
    if (!/^\d+$/.test(id)) {
      try {
        const url = new URL(id, window.location.origin);
        if (url.origin !== window.location.origin) throw new Error();
        id = url.hash.match(/^#\/item\/(\d+)$/)?.[1] || "";
      } catch {
        id = "";
      }
    }
    if (!/^[1-9]\d*$/.test(id)) {
      setError("Scan a label from this inventory, or enter the item number.");
      return false;
    }
    stop();
    navigate(`/item/${id}`);
    onClose();
    return true;
  }
  async function decode(
    source: CanvasImageSource,
    width: number,
    height: number,
  ) {
    const canvas = document.createElement("canvas"),
      scale = Math.min(1, 800 / Math.max(width, height));
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { default: jsQR } = await import("jsqr");
    return jsQR(pixels.data, canvas.width, canvas.height)?.data;
  }
  async function start() {
    setError("");
    setRunning(true);
    stopped.current = false;
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (stopped.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      video.current!.srcObject = media;
      await video.current!.play();
      const tick = async () => {
        if (stopped.current || !stream.current) return;
        const v = video.current;
        if (v?.videoWidth) {
          const result = await decode(v, v.videoWidth, v.videoHeight);
          if (stopped.current) return;
          if (result && open(result)) return;
        }
        if (!stopped.current && stream.current)
          setTimeout(() => void tick(), 250);
      };
      void tick();
    } catch {
      stop();
      setRunning(false);
      setError(
        "Camera unavailable. Allow camera access, choose a label photo, or enter its item number.",
      );
    }
  }
  async function photo(file?: File) {
    if (!file) return;
    setError("");
    try {
      const bitmap = await createImageBitmap(file);
      const code = await decode(bitmap, bitmap.width, bitmap.height);
      bitmap.close();
      if (code) open(code);
      else setError("No QR label found. Try a closer, clearer photo.");
    } catch {
      setError("Could not read that photo. Try a JPEG or PNG.");
    }
  }
  return (
    <Modal open onClose={onClose} title="Scan inventory label">
      <div className="space-y-4">
        <video
          ref={video}
          muted
          playsInline
          className={
            running
              ? "aspect-square w-full rounded-xl bg-black object-cover"
              : "hidden"
          }
        />
        {!running && (
          <button className={primaryBtn} onClick={() => void start()}>
            Start camera
          </button>
        )}
        <label className={secondaryBtn}>
          Read label photo
          <input
            className="sr-only"
            type="file"
            accept="image/*"
            onChange={(e) => void photo(e.target.files?.[0])}
          />
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            open(value);
          }}
          className="space-y-2"
        >
          <label className="block text-sm">
            Item number or scanned link
            <input
              className={inputCls}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Example: 123"
            />
          </label>
          <button className={secondaryBtn}>Open item</button>
        </form>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
