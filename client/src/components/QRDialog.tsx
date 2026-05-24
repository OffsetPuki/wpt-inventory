import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { Item } from "@shared/schema";
import Modal from "./Modal";
import { Printer } from "lucide-react";

interface QRDialogProps {
  item: Item;
  open: boolean;
  onClose: () => void;
}

export default function QRDialog({ item, open, onClose }: QRDialogProps) {
  const [dataUrl, setDataUrl] = useState("");
  const target = `${window.location.origin}/#/item/${item.id}`;

  useEffect(() => {
    if (!open) return;
    QRCode.toDataURL(target, { width: 280, margin: 1 })
      .then(setDataUrl)
      .catch(() => setDataUrl(""));
  }, [open, target]);

  function print() {
    const w = window.open("", "_blank", "width=400,height=500");
    if (!w) return;
    w.document.write(`
      <html><head><title>${item.name}</title></head>
      <body style="text-align:center;font-family:sans-serif;padding:24px">
        <img src="${dataUrl}" style="width:280px;height:280px" />
        <h2 style="margin:12px 0 4px">${item.name}</h2>
        <p style="color:#666;margin:0">${item.partNumber ?? ""}</p>
        <script>window.onload=()=>{window.print();}</script>
      </body></html>
    `);
    w.document.close();
  }

  return (
    <Modal open={open} onClose={onClose} title="QR label">
      <div className="flex flex-col items-center gap-4">
        {dataUrl ? (
          <img src={dataUrl} alt="QR code" className="rounded-xl bg-white p-3" />
        ) : (
          <div className="h-[280px] w-[280px] animate-pulse rounded-xl bg-muted" />
        )}
        <div className="text-center">
          <p className="font-semibold text-foreground">{item.name}</p>
          <p className="text-xs text-muted-foreground">Scans to this item's page</p>
        </div>
        <button
          onClick={print}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Printer className="h-5 w-5" />
          Print label
        </button>
      </div>
    </Modal>
  );
}
