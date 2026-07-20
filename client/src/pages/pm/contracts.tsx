import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { toast } from "@/components/ui/toaster";
import { useApiMutation } from "@/hooks/useApiMutation";
import { inputCls } from "@/lib/ui-styles";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { LoadingBlock, EmptyState } from "@/components/ui/Feedback";
import Header from "@/components/Header";
import Modal from "@/components/Modal";
import { cn } from "@/lib/utils";
import { formatMoney, parseMoney, formatDate, ymdToDate, parseJsonObject } from "@/lib/format";
import type { Project } from "@shared/schema";
import type { Client } from "@shared/crm-schema";
import {
  CONTRACT_KINDS,
  CONTRACT_STATUSES,
  CONTRACT_KIND_LABELS,
  CONTRACT_STATUS_LABELS,
  type Contract,
  type ContractKind,
  type ContractStatus,
} from "@shared/pm-schema";
import { FileSignature, Loader2, Plus, Pencil, Trash2, Printer, Download, Eye } from "lucide-react";

type ContractRow = Contract & { projectName: string | null };

// Per-kind / per-status pill hues — each is an exact match to a shared Chip tone.
const KIND_TONE: Record<ContractKind, ChipTone> = {
  contract: "blue",
  sow: "emerald",
  nda: "amber",
  msa: "zinc",
  other: "zinc",
};

const STATUS_TONE: Record<ContractStatus, ChipTone> = {
  draft: "zinc",
  sent: "blue",
  signed: "emerald",
  active: "emerald",
  expired: "amber",
  terminated: "red",
};

function dateSpan(c: ContractRow): string {
  const s = c.startDate ? formatDate(ymdToDate(c.startDate)) : "";
  const e = c.endDate ? formatDate(ymdToDate(c.endDate)) : "";
  if (s && e) return `${s} → ${e}`;
  if (s) return `${s} →`;
  if (e) return `→ ${e}`;
  return "—";
}

// ─── Per-kind contract fields ────────────────────────────────────────────────
// Each contract kind edits the fields that kind actually needs; the PDF
// renders them as numbered sections in this order. Values live in the
// contracts.fields JSON column, keyed by `key`. `body` stays as a free-form
// "Additional terms" section appended after these.

interface KindField {
  key: string;
  label: string;
  input: "text" | "textarea" | "number" | "select";
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: string }[];
  section: string; // heading of the numbered section in the PDF
  pdfFormat?: (v: string) => string; // raw value → sentence for the PDF
}

const KIND_FIELDS: Record<ContractKind, KindField[]> = {
  contract: [
    { key: "scopeOfWork", label: "Scope of work", input: "textarea", required: true, section: "Scope of Work",
      placeholder: "What will be built, fabricated, and installed — dimensions, location, site details…" },
    { key: "materials", label: "Materials & finish", input: "textarea", section: "Materials & Finish",
      placeholder: "Steel type, finish/coating, hardware…" },
    { key: "paymentTerms", label: "Payment terms", input: "textarea", required: true, section: "Payment Terms",
      placeholder: "e.g. 50% deposit to schedule; balance due on completion" },
    { key: "warranty", label: "Warranty", input: "text", section: "Warranty",
      placeholder: "e.g. 1-year warranty on workmanship and welds" },
  ],
  sow: [
    { key: "deliverables", label: "Scope & deliverables", input: "textarea", required: true, section: "Scope & Deliverables",
      placeholder: "Work items this scope covers, one per line…" },
    { key: "timeline", label: "Timeline & milestones", input: "textarea", section: "Timeline & Milestones",
      placeholder: "e.g. Fabrication weeks 1–2; installation week 3" },
    { key: "paymentTerms", label: "Payment terms", input: "textarea", section: "Payment Terms",
      placeholder: "e.g. Billed per milestone; Net 15" },
    { key: "exclusions", label: "Exclusions", input: "textarea", section: "Exclusions",
      placeholder: "What this scope does NOT include" },
  ],
  nda: [
    { key: "purpose", label: "Purpose of disclosure", input: "textarea", required: true, section: "Purpose",
      placeholder: "Why confidential information is being shared…" },
    { key: "direction", label: "Type", input: "select", section: "Type of Agreement",
      options: [
        { value: "mutual", label: "Mutual — both sides share" },
        { value: "provider", label: "One-way — we disclose" },
        { value: "client", label: "One-way — client discloses" },
      ],
      pdfFormat: (v) =>
        ({
          mutual: "Mutual — both parties may disclose confidential information under this Agreement.",
          provider: "One-way — the Provider discloses confidential information to the Client.",
          client: "One-way — the Client discloses confidential information to the Provider.",
        })[v] ?? v },
    { key: "termYears", label: "Confidentiality term (years)", input: "number", section: "Term",
      placeholder: "2",
      pdfFormat: (v) =>
        `The confidentiality obligations remain in effect for ${v} year${v === "1" ? "" : "s"} from the effective date.` },
  ],
  msa: [
    { key: "services", label: "Description of services", input: "textarea", required: true, section: "Services",
      placeholder: "The ongoing services this master agreement covers…" },
    { key: "paymentTerms", label: "Payment terms", input: "text", section: "Payment Terms",
      placeholder: "e.g. Net 15 from invoice date" },
    { key: "term", label: "Initial term & renewal", input: "text", section: "Term & Renewal",
      placeholder: "e.g. 12 months; renews annually unless cancelled in writing" },
  ],
  other: [],
};

// ─── PDF document ────────────────────────────────────────────────────────────
// A real .pdf file (pdfmake), generated client-side because auth rides the
// x-auth header — a plain new-tab server URL couldn't authenticate. pdfmake
// (+ its embedded font) is heavy, so it's dynamically imported: only the
// first download pays the load, and it never rides in the page bundle.

interface ShopInfo {
  name: string;
  location: string;
  phone: string;
  email: string;
}

// Builds the pdfmake document once; download / print / preview all share it.
async function makeContractPdf(c: ContractRow, shop: ShopInfo): Promise<{ pdf: any; file: string }> {
  const pdfMakeMod: any = await import("pdfmake/build/pdfmake");
  const pdfFontsMod: any = await import("pdfmake/build/vfs_fonts");
  const pdfMake = pdfMakeMod.default ?? pdfMakeMod;
  // vfs export shape moved between pdfmake versions — take the first that exists.
  pdfMake.vfs =
    pdfFontsMod.default?.pdfMake?.vfs ??
    pdfFontsMod.pdfMake?.vfs ??
    pdfFontsMod.default?.vfs ??
    pdfFontsMod.vfs ??
    pdfFontsMod.default;

  const kindLabel = CONTRACT_KIND_LABELS[c.kind];
  const today = formatDate(new Date());
  const effective = c.startDate ? formatDate(ymdToDate(c.startDate)) : today;
  const fields = parseJsonObject<Record<string, string>>(c.fields);

  // Numbered sections: the kind's structured fields first, free-form last.
  const sections: { heading: string; text: string }[] = [];
  for (const f of KIND_FIELDS[c.kind] ?? []) {
    const v = (fields[f.key] ?? "").toString().trim();
    if (!v) continue;
    sections.push({ heading: f.section, text: f.pdfFormat ? f.pdfFormat(v) : v });
  }
  if (c.body?.trim()) sections.push({ heading: "Additional Terms", text: c.body.trim() });

  const contact = [shop.location, shop.phone, shop.email].filter(Boolean).join("    ·    ");
  const metaRows: [string, string][] = [
    ["Client", c.clientName || "—"],
    ...(c.projectName ? [["Project", c.projectName] as [string, string]] : []),
    ...(c.valueCents > 0 ? [["Contract value", formatMoney(c.valueCents)] as [string, string]] : []),
    ["Effective date", effective],
    ...(c.endDate ? [["End date", formatDate(ymdToDate(c.endDate))] as [string, string]] : []),
  ];

  const sigCol = (who: string) => ({
    width: "*",
    stack: [
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 210, y2: 0, lineWidth: 0.8 }], margin: [0, 34, 0, 3] },
      { text: who.toUpperCase(), style: "sigLbl" },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 130, y2: 0, lineWidth: 0.8 }], margin: [0, 22, 0, 3] },
      { text: "DATE", style: "sigLbl" },
    ],
  });

  const dd = {
    pageSize: "LETTER",
    pageMargins: [54, 54, 54, 66],
    info: { title: `${kindLabel} — ${c.title}`, author: shop.name, subject: kindLabel },
    footer: (page: number, total: number) => ({
      columns: [
        { text: `${shop.name} — ${kindLabel}`, style: "foot" },
        { text: `Page ${page} of ${total}`, style: "foot", alignment: "right" },
      ],
      margin: [54, 24, 54, 0],
    }),
    content: [
      {
        columns: [
          {
            stack: [
              { text: shop.name.toUpperCase(), style: "co" },
              ...(contact ? [{ text: contact, style: "coSub" }] : []),
            ],
          },
          {
            width: "auto",
            stack: [
              { text: kindLabel.toUpperCase(), style: "kind", alignment: "right" },
              { text: today, style: "coSub", alignment: "right" },
            ],
          },
        ],
        columnGap: 16,
      },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 504, y2: 0, lineWidth: 1.4 }], margin: [0, 12, 0, 20] },
      { text: c.title, style: "h1" },
      {
        text:
          `This ${kindLabel} (the “Agreement”) is made as of ${effective} by and between ` +
          `${shop.name} (the “Provider”) and ${c.clientName || "the Client"} (the “Client”).`,
        margin: [0, 10, 0, 2],
        lineHeight: 1.35,
      },
      {
        table: {
          widths: [132, "*"],
          body: metaRows.map(([k, v]) => [
            { text: k.toUpperCase(), style: "metaK" },
            { text: v, style: "metaV" },
          ]),
        },
        layout: {
          hLineColor: () => "#BBBBBB",
          vLineColor: () => "#BBBBBB",
          hLineWidth: () => 0.7,
          vLineWidth: () => 0.7,
          paddingTop: () => 5,
          paddingBottom: () => 5,
          paddingLeft: () => 8,
          paddingRight: () => 8,
          fillColor: (_row: number, _node: unknown, col: number) => (col === 0 ? "#F3F1EC" : null),
        },
        margin: [0, 14, 0, 4],
      },
      ...sections.flatMap((s, i) => [
        { text: `${i + 1}.  ${s.heading.toUpperCase()}`, style: "secH" },
        { text: s.text, style: "secBody" },
      ]),
      {
        text: "Agreed and accepted by the parties as of the dates written below.",
        margin: [0, 28, 0, 0],
      },
      {
        columns: [sigCol(`${shop.name} — Authorized signature`), sigCol(`${c.clientName || "Client"} — Signature`)],
        columnGap: 44,
        unbreakable: true,
      },
    ],
    styles: {
      co: { fontSize: 15, bold: true, characterSpacing: 0.6 },
      coSub: { fontSize: 8.5, color: "#555555", margin: [0, 3, 0, 0] },
      kind: { fontSize: 9, color: "#555555", characterSpacing: 1.4 },
      h1: { fontSize: 16, bold: true },
      metaK: { fontSize: 7.5, color: "#555555", characterSpacing: 0.6, margin: [0, 1.5, 0, 0] },
      metaV: { fontSize: 10 },
      secH: { fontSize: 10, bold: true, characterSpacing: 0.7, margin: [0, 16, 0, 4] },
      secBody: { fontSize: 10.5, lineHeight: 1.35, preserveLeadingSpaces: true },
      sigLbl: { fontSize: 7.5, color: "#555555", characterSpacing: 0.6 },
      foot: { fontSize: 7.5, color: "#888888" },
    },
    defaultStyle: { fontSize: 10.5, lineHeight: 1.3 },
  };

  const file = `${kindLabel} - ${c.title}`.replace(/[\\/:*?"<>|]+/g, "").slice(0, 80).trim() + ".pdf";
  return { pdf: pdfMake.createPdf(dd), file };
}

// Preview returns a blob object-URL for an inline <iframe> viewer; the caller
// owns the URL and must revoke it when done.
async function contractPdf(
  c: ContractRow,
  shop: ShopInfo,
  action: "download" | "print" | "preview",
): Promise<string | void> {
  const { pdf, file } = await makeContractPdf(c, shop);
  if (action === "print") {
    pdf.print();
    return;
  }
  if (action === "preview") {
    const blob: Blob = await new Promise((resolve) => pdf.getBlob(resolve));
    return URL.createObjectURL(blob);
  }
  pdf.download(file);
}

// ─── Create / edit dialog ────────────────────────────────────────────────────

// Phase D #21: "New contract" links from a job hub arrive with these — the
// form opens already pointed at the project/client (and the accepted quote's
// ref + value when the job came from one).
export interface ContractPrefill {
  title?: string;
  projectId?: string;
  clientId?: string;
  clientName?: string;
  quoteRef?: string;
  valueCents?: number;
}

function ContractDialog({
  open,
  onClose,
  contract,
  projects,
  clients,
  onCreated,
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  contract: ContractRow | null;
  projects: Project[];
  clients: Client[];
  onCreated?: (row: Contract) => void;
  prefill?: ContractPrefill | null;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<ContractKind>("contract");
  const [status, setStatus] = useState<ContractStatus>("draft");
  const [clientSel, setClientSel] = useState("");
  const [clientNameText, setClientNameText] = useState("");
  const [projectSel, setProjectSel] = useState("");
  const [valueStr, setValueStr] = useState("");
  const [quoteRef, setQuoteRef] = useState("");
  const [warrantyMonthsStr, setWarrantyMonthsStr] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [body, setBody] = useState("");
  const [notes, setNotes] = useState("");
  // Per-kind structured values, keyed by KindField.key. Kept as one object
  // across kind switches (shared keys like paymentTerms carry over); only the
  // current kind's keys are saved.
  const [fieldVals, setFieldVals] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    // Prefill only seeds a NEW contract; editing always shows the stored row.
    const pre = contract ? null : prefill;
    setTitle(contract?.title ?? pre?.title ?? "");
    setKind(contract?.kind ?? "contract");
    setStatus(contract?.status ?? "draft");
    setClientSel(contract?.clientId ? String(contract.clientId) : pre?.clientId ?? "");
    setClientNameText(contract?.clientId ? "" : contract?.clientName ?? pre?.clientName ?? "");
    setProjectSel(contract?.projectId ? String(contract.projectId) : pre?.projectId ?? "");
    setValueStr(
      contract && contract.valueCents
        ? String(contract.valueCents / 100)
        : pre?.valueCents
          ? String(pre.valueCents / 100)
          : ""
    );
    setQuoteRef(contract?.quoteRef ?? pre?.quoteRef ?? "");
    setWarrantyMonthsStr(
      contract?.warrantyMonths != null ? String(contract.warrantyMonths) : ""
    );
    setStartDate(contract?.startDate ?? "");
    setEndDate(contract?.endDate ?? "");
    setBody(contract?.body ?? "");
    setNotes(contract?.notes ?? "");
    setFieldVals(parseJsonObject<Record<string, string>>(contract?.fields));
  }, [open, contract, prefill]);

  const save = useApiMutation<Contract>({
    request: () => {
      // Persist only the current kind's keys — selects fall back to their
      // first option so the PDF never renders an empty select section.
      const picked: Record<string, string> = {};
      for (const f of KIND_FIELDS[kind]) {
        const v = (fieldVals[f.key] ?? (f.input === "select" ? f.options?.[0]?.value ?? "" : "")).trim();
        if (v) picked[f.key] = v;
      }
      const payload = {
        title: title.trim(),
        kind,
        status,
        clientId: clientSel ? Number(clientSel) : null,
        clientName: clientSel ? null : clientNameText.trim() || null,
        projectId: projectSel ? Number(projectSel) : null,
        valueCents: parseMoney(valueStr),
        quoteRef: quoteRef.trim() || null,
        warrantyMonths: (() => {
          const n = parseInt(warrantyMonthsStr, 10);
          return Number.isFinite(n) && n > 0 ? n : null;
        })(),
        startDate: startDate || null,
        endDate: endDate || null,
        fields: JSON.stringify(picked),
        body: body.trim() || null,
        notes: notes.trim() || null,
      };
      return contract
        ? { method: "PATCH", url: `/api/pm/contracts/${contract.id}`, body: payload }
        : { method: "POST", url: "/api/pm/contracts", body: payload };
    },
    invalidate: [["pm-contracts"]],
    successTitle: contract ? "Contract updated" : "Contract created",
    errorTitle: "Could not save",
    onSuccess: (row) => {
      onClose();
      // New contract → open it right away so Download / Print is one click.
      if (!contract) onCreated?.(row);
    },
  });

  const del = useApiMutation({
    request: () => ({ method: "DELETE", url: `/api/pm/contracts/${contract!.id}` }),
    invalidate: [["pm-contracts"]],
    successTitle: "Contract deleted",
    errorTitle: "Could not delete",
    onSuccess: onClose,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={contract ? "Edit contract" : "New contract"}
      maxWidth="max-w-2xl"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) {
            toast({ variant: "destructive", title: "Title is required" });
            return;
          }
          // Per-kind required fields — a job contract without a scope or
          // payment terms isn't a document worth sending.
          const missing = KIND_FIELDS[kind].filter(
            (f) => f.required && !(fieldVals[f.key] ?? "").trim(),
          );
          if (missing.length > 0) {
            toast({
              variant: "destructive",
              title: `${CONTRACT_KIND_LABELS[kind]} needs: ${missing.map((f) => f.label).join(", ")}`,
            });
            return;
          }
          save.mutate();
        }}
        className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Title</span>
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Kind</span>
            <select
              className={inputCls}
              value={kind}
              onChange={(e) => setKind(e.target.value as ContractKind)}
            >
              {CONTRACT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CONTRACT_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Status</span>
            <select
              className={inputCls}
              value={status}
              onChange={(e) => setStatus(e.target.value as ContractStatus)}
            >
              {CONTRACT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {CONTRACT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Client</span>
            <select
              className={inputCls}
              value={clientSel}
              onChange={(e) => setClientSel(e.target.value)}
            >
              <option value="">No linked client (type a name below)</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.company ? ` — ${c.company}` : ""}
                </option>
              ))}
            </select>
          </label>
          {!clientSel && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Client name (free text)</span>
              <input
                className={inputCls}
                value={clientNameText}
                onChange={(e) => setClientNameText(e.target.value)}
                placeholder="Acme Corp"
              />
            </label>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Project (optional)</span>
            <select
              className={inputCls}
              value={projectSel}
              onChange={(e) => setProjectSel(e.target.value)}
            >
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Value ($)</span>
            <input
              className={inputCls}
              value={valueStr}
              onChange={(e) => setValueStr(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Quote ref (optional)</span>
            <input
              className={inputCls}
              value={quoteRef}
              onChange={(e) => setQuoteRef(e.target.value)}
              placeholder="Q-2026-0001"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Start date</span>
            <input
              type="date"
              className={inputCls}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">End date</span>
            <input
              type="date"
              className={inputCls}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
        </div>
        {KIND_FIELDS[kind].length > 0 && (
          <div className="flex flex-col gap-4 rounded-xl border border-border bg-muted/20 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {CONTRACT_KIND_LABELS[kind]} details — these become the document’s numbered sections
            </p>
            {KIND_FIELDS[kind].map((f) => (
              <label key={f.key} className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-foreground">
                  {f.label}
                  {f.required && <span className="text-red-600 dark:text-red-400"> *</span>}
                </span>
                {f.input === "textarea" ? (
                  <textarea
                    className={cn(inputCls, "h-auto min-h-[100px] py-2 leading-relaxed")}
                    rows={4}
                    value={fieldVals[f.key] ?? ""}
                    placeholder={f.placeholder}
                    onChange={(e) => setFieldVals((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                ) : f.input === "select" ? (
                  <select
                    className={inputCls}
                    value={fieldVals[f.key] ?? f.options?.[0]?.value ?? ""}
                    onChange={(e) => setFieldVals((v) => ({ ...v, [f.key]: e.target.value }))}
                  >
                    {(f.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.input === "number" ? "number" : "text"}
                    min={f.input === "number" ? 0 : undefined}
                    className={inputCls}
                    value={fieldVals[f.key] ?? ""}
                    placeholder={f.placeholder}
                    onChange={(e) => setFieldVals((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                )}
              </label>
            ))}
            {kind === "contract" && (
              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-foreground">Warranty (months)</span>
                <input
                  type="number"
                  min="0"
                  className={inputCls}
                  value={warrantyMonthsStr}
                  onChange={(e) => setWarrantyMonthsStr(e.target.value)}
                  placeholder="12"
                />
                <span className="text-xs text-muted-foreground">
                  When the job is marked done, a callback task is queued 30 days before the warranty ends.
                </span>
              </label>
            )}
          </div>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Additional terms (optional)</span>
          <textarea
            className={cn(inputCls, "h-auto min-h-[100px] py-2")}
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Any extra clauses — appended as the last section of the document"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">Notes (optional)</span>
          <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <div className="mt-1 flex items-center gap-2">
          {contract && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Delete this contract?")) del.mutate();
              }}
              disabled={del.isPending}
              className="flex h-11 items-center gap-2 rounded-xl border border-border px-4 font-medium text-red-600 hover:border-red-500 disabled:opacity-60 dark:text-red-400"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          )}
          <button
            type="submit"
            disabled={save.isPending}
            className="ml-auto flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {contract ? "Save changes" : "Create contract"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Read view ───────────────────────────────────────────────────────────────

function ContractViewModal({
  contract,
  onClose,
  onEdit,
  canEdit,
  shop,
}: {
  contract: ContractRow | null;
  onClose: () => void;
  onEdit: () => void;
  canEdit: boolean;
  shop: ShopInfo;
}) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // Revoke the previous blob URL whenever it's replaced or the modal unmounts.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);
  const runPdf = async (action: "download" | "print" | "preview") => {
    if (!contract) return;
    setPdfBusy(true);
    try {
      const url = await contractPdf(contract, shop, action);
      if (action === "preview" && url) setPreviewUrl(url);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Could not build the PDF", description: e?.message });
    } finally {
      setPdfBusy(false);
    }
  };
  const fieldSections = contract
    ? KIND_FIELDS[contract.kind]
        .map((f) => ({ f, v: (parseJsonObject<Record<string, string>>(contract.fields)[f.key] ?? "").trim() }))
        .filter(({ v }) => v)
    : [];
  return (
    <>
    <Modal
      open={!!contract}
      onClose={onClose}
      title={contract?.title ?? ""}
      maxWidth="max-w-2xl"
    >
      {contract && (
        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={KIND_TONE[contract.kind]}>{CONTRACT_KIND_LABELS[contract.kind]}</Chip>
            <Chip tone={STATUS_TONE[contract.status]}>{CONTRACT_STATUS_LABELS[contract.status]}</Chip>
          </div>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase text-muted-foreground">Client</p>
              <p className="mt-0.5 font-medium text-foreground">
                {contract.clientName || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Project</p>
              <p className="mt-0.5 font-medium text-foreground">
                {contract.projectName || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Value</p>
              <p className="mt-0.5 font-medium tabular-nums text-foreground">
                {formatMoney(contract.valueCents)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase text-muted-foreground">Dates</p>
              <p className="mt-0.5 font-medium text-foreground">{dateSpan(contract)}</p>
            </div>
            {contract.quoteRef && (
              <div>
                <p className="text-xs uppercase text-muted-foreground">Quote</p>
                <p className="mt-0.5 font-medium text-foreground">{contract.quoteRef}</p>
              </div>
            )}
            {contract.warrantyMonths != null && contract.warrantyMonths > 0 && (
              <div>
                <p className="text-xs uppercase text-muted-foreground">Warranty</p>
                <p className="mt-0.5 font-medium text-foreground">
                  {contract.warrantyMonths} month{contract.warrantyMonths === 1 ? "" : "s"}
                </p>
              </div>
            )}
          </div>
          {fieldSections.map(({ f, v }) => (
            <div key={f.key}>
              <p className="mb-1.5 text-xs uppercase text-muted-foreground">{f.section}</p>
              <div className="whitespace-pre-wrap rounded-lg bg-muted/40 p-4 text-sm leading-relaxed text-foreground">
                {f.input === "select"
                  ? f.options?.find((o) => o.value === v)?.label ?? v
                  : v}
              </div>
            </div>
          ))}
          {contract.body && (
            <div>
              <p className="mb-1.5 text-xs uppercase text-muted-foreground">Additional terms</p>
              <div className="whitespace-pre-wrap rounded-lg bg-muted/40 p-4 text-sm leading-relaxed text-foreground">
                {contract.body}
              </div>
            </div>
          )}
          {contract.notes && (
            <div>
              <p className="mb-1 text-xs uppercase text-muted-foreground">Notes</p>
              <p className="text-sm text-foreground">{contract.notes}</p>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            {canEdit && (
              <button
                onClick={onEdit}
                className="flex h-11 items-center gap-2 rounded-xl border border-border px-5 font-medium text-foreground hover:border-primary"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </button>
            )}
            <button
              onClick={() => runPdf("preview")}
              disabled={pdfBusy}
              className="flex h-11 items-center gap-2 rounded-xl border border-border px-5 font-medium text-foreground hover:border-primary disabled:opacity-60"
              title="See the finished document without downloading"
            >
              {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
              Preview
            </button>
            <button
              onClick={() => runPdf("print")}
              disabled={pdfBusy}
              className="flex h-11 items-center gap-2 rounded-xl border border-border px-5 font-medium text-foreground hover:border-primary disabled:opacity-60"
            >
              <Printer className="h-4 w-4" />
              Print
            </button>
            <button
              onClick={() => runPdf("download")}
              disabled={pdfBusy}
              className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
              title="Downloads the customer-ready PDF"
            >
              {pdfBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download PDF
            </button>
          </div>
        </div>
      )}
    </Modal>
    {previewUrl && contract && (
      <Modal
        open
        onClose={() => setPreviewUrl(null)}
        title={`Preview — ${contract.title}`}
        maxWidth="max-w-4xl"
      >
        <div className="flex flex-col gap-3">
          {/* Desktop browsers render the PDF inline; some phones won't — the
              fallback links below cover those. bg-white so the Letter page
              reads correctly in dark mode too. */}
          <iframe
            src={previewUrl}
            title="Contract preview"
            className="h-[72vh] w-full rounded-lg border border-border bg-white"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Preview not showing on this device?{" "}
              <button
                type="button"
                className="underline hover:text-foreground"
                onClick={() => window.open(previewUrl, "_blank")}
              >
                Open in a new tab
              </button>
            </p>
            <button
              onClick={() => runPdf("download")}
              disabled={pdfBusy}
              className="flex h-10 items-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              Download PDF
            </button>
          </div>
        </div>
      </Modal>
    )}
    </>
  );
}

// ─── Contracts page ──────────────────────────────────────────────────────────

// Parse a job hub's "New contract" deep link. Hash routing (wouter
// useHashLocation) keeps the query inside the hash — check there first,
// window.location.search as fallback (same deep-link idea as home.tsx).
function readPrefillFromUrl(): ContractPrefill | null {
  const qs = window.location.hash.split("?")[1] ?? window.location.search.replace(/^\?/, "");
  const p = new URLSearchParams(qs);
  if (p.get("new") !== "1") return null;
  const valueCents = parseInt(p.get("valueCents") ?? "", 10);
  return {
    title: p.get("title") ?? undefined,
    projectId: p.get("projectId") ?? undefined,
    clientId: p.get("clientId") ?? undefined,
    clientName: p.get("clientName") ?? undefined,
    quoteRef: p.get("quoteRef") ?? undefined,
    valueCents: Number.isFinite(valueCents) && valueCents > 0 ? valueCents : undefined,
  };
}

export default function PmContractsPage() {
  const { isElevated } = useAuth();
  const [kindTab, setKindTab] = useState<"" | ContractKind>("");
  const [statusFilter, setStatusFilter] = useState("");
  // Deep link from a job hub → open the create dialog prefilled (Phase D #21).
  const [prefill] = useState<ContractPrefill | null>(readPrefillFromUrl);
  const [dialogOpen, setDialogOpen] = useState(() => !!prefill);
  const [editing, setEditing] = useState<ContractRow | null>(null);
  const [viewing, setViewing] = useState<ContractRow | null>(null);

  const { data: projects = [] } = useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => (await apiRequest("GET", "/api/projects")).json(),
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["crm-clients"],
    queryFn: async () => (await apiRequest("GET", "/api/crm/clients")).json(),
  });

  const params = new URLSearchParams();
  if (kindTab) params.set("kind", kindTab);
  if (statusFilter) params.set("status", statusFilter);
  const qs = params.toString();

  const { data: contracts = [], isLoading } = useQuery<ContractRow[]>({
    queryKey: ["pm-contracts", kindTab, statusFilter],
    queryFn: async () =>
      (await apiRequest("GET", `/api/pm/contracts${qs ? `?${qs}` : ""}`)).json(),
  });

  // Shop identity for the printable document's letterhead — same source as
  // the Quote Builder's printed quote (Settings → shop block).
  const { data: shopSettings } = useQuery<{ shop: Partial<ShopInfo> }>({
    queryKey: ["quote-settings"],
    queryFn: async () => (await apiRequest("GET", "/api/quotes/settings")).json(),
  });
  const shop: ShopInfo = {
    name: shopSettings?.shop?.name || "CJM Metals",
    location: shopSettings?.shop?.location || "",
    phone: shopSettings?.shop?.phone || "",
    email: shopSettings?.shop?.email || "",
  };

  const tabs: { value: "" | ContractKind; label: string }[] = [
    { value: "", label: "All" },
    ...CONTRACT_KINDS.map((k) => ({ value: k, label: CONTRACT_KIND_LABELS[k] })),
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <Header title="Contracts & SOWs" description="Agreements, scopes of work, and NDAs">
        {isElevated && (
          <button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-5 w-5" />
            New contract
          </button>
        )}
      </Header>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {tabs.map((t) => (
            <button
              key={t.value}
              onClick={() => setKindTab(t.value)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
                kindTab === t.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={cn(inputCls, "ml-auto w-auto min-w-[150px]")}
        >
          <option value="">All statuses</option>
          {CONTRACT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {CONTRACT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <LoadingBlock />
      ) : contracts.length === 0 ? (
        <EmptyState icon={FileSignature} message="No contracts yet">
          {isElevated && (
            <button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              className="flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-5 w-5" />
              Create the first contract
            </button>
          )}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Kind</th>
                <th className="px-4 py-3 font-medium">Client</th>
                <th className="px-4 py-3 font-medium">Project</th>
                <th className="px-4 py-3 text-right font-medium">Value</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Dates</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border border-t border-border">
              {contracts.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setViewing(c)}
                  className="cursor-pointer transition-colors hover:bg-accent/50"
                >
                  <td className="px-4 py-3 font-medium text-foreground">{c.title}</td>
                  <td className="px-4 py-3">
                    <Chip tone={KIND_TONE[c.kind]}>{CONTRACT_KIND_LABELS[c.kind]}</Chip>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.clientName || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{c.projectName || "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">
                    {formatMoney(c.valueCents)}
                  </td>
                  <td className="px-4 py-3">
                    <Chip tone={STATUS_TONE[c.status]}>{CONTRACT_STATUS_LABELS[c.status]}</Chip>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {dateSpan(c)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ContractViewModal
        contract={viewing}
        onClose={() => setViewing(null)}
        canEdit={isElevated}
        shop={shop}
        onEdit={() => {
          setEditing(viewing);
          setViewing(null);
          setDialogOpen(true);
        }}
      />
      {isElevated && (
        <ContractDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          contract={editing}
          projects={projects}
          clients={clients}
          prefill={prefill}
          onCreated={(row) =>
            setViewing({
              ...row,
              // POST returns the raw row — the list GET coalesces these via
              // joins, so resolve them here for the immediately-opened view.
              clientName:
                row.clientName ??
                (row.clientId != null
                  ? clients.find((cl) => cl.id === row.clientId)?.name ?? null
                  : null),
              projectName:
                row.projectId != null
                  ? projects.find((p) => p.id === row.projectId)?.name ?? null
                  : null,
            })
          }
        />
      )}
    </div>
  );
}
