import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {useApiMutation} from '@/hooks/useApiMutation';
import { apiRequest } from "@/lib/queryClient";
import { toast } from "@/components/ui/toaster";
import type { JobTemplate, TemplateParam } from "@shared/schema";
import Modal from "./Modal";
import {RecordSelect} from './RecordSelect';
import LucideIcon from "./LucideIcon";
import { ArrowLeft, Loader2 } from "lucide-react";

const inputCls =
  "h-11 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-ring";

function parseParams(tpl: JobTemplate): TemplateParam[] {
  try {
    return JSON.parse(tpl.params as unknown as string);
  } catch {
    return [];
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (projectId: number) => void;
}

export default function FromTemplateDialog({ open, onClose, onCreated }: Props) {
  const [selected, setSelected] = useState<JobTemplate | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [jobNumber, setJobNumber] = useState("");
  const [name, setName] = useState("");
  const [customer, setCustomer] = useState("");
  const [preview,setPreview]=useState<{rows:{label:string;qty:number;unit?:string;notes?:string}[];version:string;inputs:string;key:string}|null>(null);
  const [reviewed,setReviewed]=useState(false);
  const previewCurrent=!!preview&&preview.key===selected?.key&&preview.inputs===JSON.stringify(values);
  const previewRequest=useMutation({mutationFn:async()=>{const key=selected!.key,inputs=JSON.stringify(values);const r=await apiRequest('POST',`/api/job-templates/${key}/preview`,{params:values});return {rows:await r.json(),version:r.headers.get('X-Template-Version')||'',inputs,key};},onSuccess:result=>{setPreview(result);setReviewed(false);}});

  const { data: templates = [] } = useQuery<JobTemplate[]>({
    queryKey: ["job-templates"],
    queryFn: async () => (await apiRequest("GET", "/api/job-templates")).json(),
    enabled: open,
    // Admin-managed config — basically never changes during a user's session.
    staleTime: 5 * 60_000,
    refetchInterval: false,
  });

  function reset() {
    setSelected(null);
    setValues({});
    setJobNumber("");
    setName("");
    setCustomer("");
    setPreview(null);setReviewed(false);
  }

  function pick(tpl: JobTemplate) {
    const params = parseParams(tpl);
    const initial: Record<string, any> = {};
    for (const p of params) initial[p.key] = p.defaultValue ?? "";
    setValues(initial);
    setName(tpl.label); // pre-fill project name with template label
    setSelected(tpl);
  }

  const create = useApiMutation({
    request: () => ({method:'POST',url:'/api/projects/from-template',body:{
        templateKey: selected!.key,
        templateVersion:preview!.version,
        params: values,
        jobNumber: jobNumber.trim(),
        name: name.trim(),
        clientId: customer ? Number(customer) : null,
    }}),
    invalidate:[['projects']],
    successTitle:'Job created',
    errorTitle:'Could not create job',
    onSuccess: (project) => {
      reset();
      onCreated(project.id);
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!jobNumber.trim() || !name.trim()) {
      toast({ variant: "destructive", title: "Job number and name are required" });
      return;
    }
    if(!previewCurrent||!reviewed)return;
    create.mutate();
  }

  function handleClose() {
    reset();
    onClose();
  }

  const enabledTemplates = templates.filter((t) => t.enabled);
  const params = selected ? parseParams(selected) : [];

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={selected ? selected.label : "Start from template"}
      maxWidth="max-w-lg"
    >
      {!selected ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {enabledTemplates.map((t) => (
            <button
              key={t.key}
              onClick={() => pick(t)}
              className="flex flex-col gap-2 rounded-xl border border-border p-4 text-left transition-colors hover:border-primary"
            >
              <LucideIcon name={t.icon} className="h-6 w-6 text-primary" />
              <span className="font-semibold text-foreground">{t.label}</span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{t.blurb}</span>
            </button>
          ))}
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="-mt-1 inline-flex items-center gap-1.5 self-start text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Pick another template
          </button>

          {params.map((p) => (
            <label key={p.key} className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">
                {p.label}
                {p.unit ? ` (${p.unit})` : ""}
              </span>
              {p.kind === "select" ? (
                <select
                  className={inputCls}
                  value={values[p.key] ?? ""}
                  onChange={(e) => setValues({ ...values, [p.key]: e.target.value })}
                >
                  {(p.options ?? []).map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={inputCls}
                  type={p.kind === "number" ? "number" : "text"}
                  step="any"
                  value={values[p.key] ?? ""}
                  onChange={(e) => setValues({ ...values, [p.key]: e.target.value })}
                />
              )}
              {p.helper && <span className="text-xs text-muted-foreground">{p.helper}</span>}
            </label>
          ))}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Job number</span>
              <input
                className={inputCls}
                value={jobNumber}
                onChange={(e) => setJobNumber(e.target.value)}
                placeholder="e.g. FLP-2026-014"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-foreground">Project name</span>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Customer (optional)</span>
            <RecordSelect type="clients" name="clientId"
              className={inputCls}
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
            />
          </label>

          <section className="space-y-3 rounded-xl border p-4"><h3 className="font-semibold">Review what will be created</h3><button type="button" className="min-h-11 rounded-lg border px-3 text-sm" disabled={previewRequest.isPending} onClick={()=>previewRequest.mutate()}>{previewRequest.isPending?'Calculating…':'Preview checklist'}</button>{previewRequest.isError&&<p role="alert" className="text-sm text-destructive">{previewRequest.error.message}</p>}{previewCurrent&&preview&&<><ul className="divide-y">{preview.rows.map((r,index)=><li key={index} className="py-2 text-sm"><strong>{r.label}</strong> · {r.qty} {r.unit}{r.notes&&<p className="mt-1 text-xs text-muted-foreground">{r.notes}</p>}</li>)}</ul><p className="text-xs text-muted-foreground">Template revision {preview.version.slice(0,8)}. These quantities use the values above. Later template edits will not change this job.</p><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>I reviewed these quantities and assumptions.</label></>}</section>
          <div className="suite-modal-actions"><button
            type="submit"
            disabled={create.isPending||!previewCurrent||!reviewed}
            className="mt-1 flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-base font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {create.isPending && <Loader2 className="h-5 w-5 animate-spin" />}
            Create project & build checklist
          </button></div>
        </form>
      )}
    </Modal>
  );
}
