import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { Item } from "@shared/schema";
import { locationString } from "@/lib/format";
import Modal from "../Modal";
import { primaryBtn } from "@/lib/ui-styles";
export default function BatchLabels({
  items,
  onClose,
}: {
  items: Item[];
  onClose: () => void;
}) {
  const [labels, setLabels] = useState<{ item: Item; url: string }[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    Promise.all(
      items.map(async (item) => ({
        item,
        url: await QRCode.toDataURL(`${location.origin}/#/item/${item.id}`, {
          width: 200,
          margin: 1,
        }),
      })),
    )
      .then((v) => {
        if (live) setLabels(v);
      })
      .catch(() => setError("Could not generate labels."));
    return () => {
      live = false;
    };
  }, [items]);
  function print() {
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) {
      setError("Allow the print window and try again.");
      return;
    }
    const esc = (s: string) =>
      s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
    w.document.write(
      `<html><head><title>Inventory labels</title></head><body style="font-family:sans-serif;display:flex;flex-wrap:wrap;gap:12px">${labels.map(({ item, url }) => `<article style="width:2.4in;text-align:center;padding:12px;border:1px solid #aaa;break-inside:avoid"><img src="${url}" width="150" height="150"><h3>${esc(item.name)}</h3><p>#${item.id} ${esc(item.partNumber || "")}</p><small>${esc(locationString(item))}</small></article>`).join("")}</body></html>`,
    );
    w.document.close();
    Promise.all(
      Array.from(w.document.images).map((i) => i.decode().catch(() => {})),
    ).then(() => w.print());
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={`Print ${items.length} labels`}
      maxWidth="max-w-2xl"
    >
      <p className="mb-4 text-sm text-muted-foreground">
        Each label includes the item number, location, and a QR code that opens
        its stock page.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {labels.map(({ item, url }) => (
          <div key={item.id} className="rounded-lg border p-2 text-center">
            <img
              className="mx-auto h-24 w-24"
              src={url}
              alt={`QR for ${item.name}`}
            />
            <p className="text-sm">{item.name}</p>
          </div>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <button
        onClick={print}
        disabled={labels.length !== items.length}
        className={`${primaryBtn} mt-4`}
      >
        Print labels
      </button>
    </Modal>
  );
}
