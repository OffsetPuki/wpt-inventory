import {L} from '@/lib/language';
import {DesignRegistry} from '@/components/design-studio/DesignRegistry';
import JobFileUploader from '@/components/JobFileUploader';
import JobCompletion from '@/components/JobCompletion';
import RecordCommunication from '@/components/RecordCommunication';
import OfflineJobPack from '@/components/OfflineJobPack';
import ConnectedRecords from '@/components/ConnectedRecords';
import JobMoneyGraphs from '@/components/JobMoneyGraphs';
import DeleteJobButton from '@/components/DeleteJobButton';
import {JOB_STATUS_LABELS} from "@shared/suite-contracts";
import RelatedPreviews from '@/components/RelatedPreviews';
import { ExtraBilling } from "./suite-reviews";
import JobForecast from '@/components/JobForecast';
import { useSuiteQuery } from "@/lib/suite-query";
import { lazy, Suspense, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useDeepLink } from "@/lib/deep-link";
import { useFormDraft } from "@/lib/form-draft";
import { useApiMutation } from "@/hooks/useApiMutation";
import { inputCls, primaryBtn, secondaryBtn } from "@/lib/ui-styles";
import { shrinkAndUpload as uploadPhoto } from "@/lib/uploadPhoto";
import {apiRequest,getAuthToken} from '@/lib/queryClient';
import {JOB_FILE_ACCEPT,JOB_FILE_MAX_BYTES,isJobImage} from '@shared/job-files';
import {FileText,Download} from 'lucide-react';
import { formatMoney } from "@/lib/format";
import { RetryBlock } from "@/components/RetryBlock";
import Modal from "@/components/Modal";
import Header from "@/components/Header";
const Checklist = lazy(() => import("@/components/ProjectChecklist"));
const Documents = lazy(() => import("@/components/DocumentsCard"));
const Contracts = lazy(() =>
  import("../components/JobAgreementCards").then((m) => ({ default: m.ContractsCard })),
);
const Changes = lazy(() =>
  import("../components/JobAgreementCards").then((m) => ({ default: m.ChangeOrdersCard })),
);
const Publish = lazy(() => import("./job-publish"));
const TaskDialog = lazy(() =>
  import("./pm/task-dialog").then((m) => ({ default: m.TaskDialog })),
);
const Card = ({ title, children }: { title: string; children: any }) => (
  <section className="rounded-xl border bg-card p-5">
    <h2 className="mb-4 font-semibold">{title}</h2>
    {children}
  </section>
);

export default function JobWorkspace({ id }: { id: string }) {
  const { isElevated } = useAuth();
  const [, setLocation] = useLocation();
  const current = useDeepLink("tab");
  const tab = [
    "overview",
    "work",
    "materials",
    ...(isElevated ? ["money"] : []),
    "files",
    "activity",
  ].includes(current || "")
    ? current!
    : "overview";
  const query = useSuiteQuery(
    ["suite-job", Number(id)],
    `/api/suite/jobs/${id}`,
  );
  const [planning, setPlanning] = useState(false),
    [addingTask, setAddingTask] = useState(false),
    [publishing, setPublishing] = useState(false);
  const people = useSuiteQuery<any[]>(
    ["suite-people"],
    "/api/suite/people",
    addingTask,
  );
  const start = useApiMutation({
    request: () => ({
      method: "POST",
      url: "/api/pm/time/start",
      body: { projectId: Number(id) },
    }),
    errorTitle: "Could not start work",
    successTitle: "Timer started",
  });
  const status = useApiMutation<any, string>({
    request: (value) => ({
      method: "PATCH",
      url: `/api/projects/${id}`,
      body: { status: value, version: query.data?.job.version },
    }),
    errorTitle: "Could not change job status",
    successTitle: "Job updated",
  });
  if (query.isError) return <RetryBlock query={query} />;
  if (!query.data) return <p role="status"><L>{"Loading job…"}</L></p>;
  const d = query.data,
    j = d.job;
  const project = {
    ...j,
    jobNumber: j.job_number,
    clientId: j.client_id,
    completedAt: j.completed_at,
  };
  return (
    <div className="space-y-5">
      <Link className="text-sm underline" href="/projects">
        <L>{"← Jobs"}</L>{" "}</Link>
      <Header
        title={j.name}
        description={`${j.job_number} · ${j.site} · ${JOB_STATUS_LABELS[j.status]||j.status}`}
      />
      <div className="flex flex-wrap gap-2">
        <button
          className={primaryBtn}
          onClick={() => start.mutate()}
          disabled={start.isPending}
        >
          <L>{"Start work"}</L>
        </button>
        {isElevated && (
          <>
            <button className={secondaryBtn} onClick={() => setPlanning(true)}>
              <L>{"Job settings"}</L>
            </button>
            <select
              aria-label="Job status"
              className="h-11 rounded-lg border bg-background px-3"
              value={j.status}
              onChange={(e) => status.mutate(e.target.value)}
              disabled={status.isPending}
            >
              <option value="active"><L>{"Active"}</L></option>
              <option value="on_hold"><L>{"On hold"}</L></option>
              <option value="done"><L>{"Completed"}</L></option>
            </select>
            <DeleteJobButton job={{id:j.id,name:j.name,jobNumber:j.job_number,_version:j._version}} onDeleted={()=>setLocation('/projects')}/>
          </>
        )}
      </div>
      <ConnectedRecords kind="job" id={Number(id)}/>
      <OfflineJobPack id={Number(id)}/>
      {isElevated&&tab==='overview'&&<JobCompletion key={id} id={Number(id)}/>}
      <nav
        aria-label="Job sections"
        className="flex gap-1 overflow-x-auto border-b pb-2"
      >
        {[
          "overview",
          "work",
          "materials",
          ...(isElevated ? ["money"] : []),
          "files",
          "activity",
        ].map((t) => (
          <Link
            key={t}
            href={`/project/${id}?tab=${t}`}
            className={`rounded-lg px-4 py-2 capitalize ${tab === t ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
          >
            {t}
          </Link>
        ))}
      </nav>
      <Suspense fallback={<p role="status"><L>{"Loading section…"}</L></p>}>
        {tab === "overview" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Next actions">
              {d.readiness.ready ? (
                <p><L>{"Ready for the planned work."}</L></p>
              ) : (
                d.readiness.blockers.map((b: any, i: number) => (
                  <Link
                    key={i}
                    className="block border-t py-3 underline"
                    onClick={() => {
                      if (isElevated && ["dates", "billing"].includes(b.kind))
                        setPlanning(true);
                    }}
                    href={`/project/${id}?tab=${!isElevated && b.tab === "money" ? "activity" : b.tab}`}
                  >
                    {b.label}
                    {!isElevated && b.tab === "money"
                      ? " — ask the owner"
                      : ""}{" "}
                    →
                  </Link>
                ))
              )}
              {d.readiness.override && (
                <p className="mt-3 text-sm text-amber-700">
                  <L>{"Date confirmed with exception:"}</L>{" "}{d.readiness.override.reason}
                </p>
              )}
              {j.status === "done" && (
                <p className="mt-3">
                  <L>{"Review final billing, unused materials, tools and completed-work photos."}</L>{" "}</p>
              )}
            </Card>
            <Card title="Customer & scope">
              {d.customer ? (
                <>
                  <Link
                    className="font-medium underline"
                    href={`/crm/clients?client=${d.customer.id}`}
                  >
                    {d.customer.name}
                  </Link>
                  <p>{d.customer.company}</p>
                  <p>
                    <a href={`tel:${d.customer.phone || ""}`}>
                      {d.customer.phone}
                    </a>
                  </p>
                  <p>
                    <a href={`mailto:${d.customer.email || ""}`}>
                      {d.customer.email}
                    </a>
                  </p>
                </>
              ) : (
                <p><L>{"Customer link needs review."}</L></p>
              )}
              <p className="mt-3">{j.site_address || "Job address not set"}</p>
              <p className="text-sm">
                {j.preferred_language === "es" ? "Spanish" : "English"} ·{" "}
                {j.start_date || "Start date not set"}{" "}
                {j.due_date && `to ${j.due_date}`} · {j.schedule_state}
              </p>
              {d.quote && (
                <Link
                  className="mt-3 block underline"
                  href={`/crm/quotes?quote=${d.quote.id}`}
                >
                  <L>{"Open"}</L>{" "}{d.quote.number} · {d.quote.status}
                </Link>
              )}
            </Card>
          </div>
        )}
        {tab === "work" && (
          <div className="space-y-5">
            <Card title="Work plan">
              <div className="mb-4 flex gap-3">
                <button
                  className={primaryBtn}
                  onClick={() => setAddingTask(true)}
                >
                  <L>{"Add task"}</L>{" "}</button>
                <Link
                  className={secondaryBtn}
                  href={`/pm/time?projectId=${id}`}
                >
                  <L>{"Time entries"}</L>{" "}</Link>
                <Link className={secondaryBtn} href="/pm/schedule">
                  <L>{"Crew calendar"}</L>{" "}</Link>
              </div>
              {d.readiness.tasks.length ? (
                d.readiness.tasks.map((t: any) => (
                  <Link
                    key={t.id}
                    className="block border-t py-3"
                    href={`/pm/board?task=${t.id}`}
                  >
                    {t.title} · {t.status.replace("_", " ")} ·{" "}
                    {t.due_date || "No due date"}
                  </Link>
                ))
              ) : (
                <p><L>{"No open tasks."}</L></p>
              )}
            </Card>
            {!!d.readiness.conflicts.length && (
              <Card title="Scheduling conflicts">
                {d.readiness.conflicts.map((c: any, i: number) => (
                  <p key={i} className="py-2">
                    {c.title}
                  </p>
                ))}
              </Card>
            )}
          </div>
        )}
        {tab === "materials" && <JobMaterials data={d} owner={isElevated} />}
        {tab === "money" && isElevated && (
          <JobMoney project={project} actions={d.actions} />
        )}
        {tab === "files" && (
          <>
            {isElevated&&<RelatedPreviews projectId={Number(id)}/>}
            <JobFiles id={Number(id)} />
            {isElevated&&<RecordCommunication key={id} kind="job" id={Number(id)}/>}
            <Documents projectId={Number(id)} />
            <Contracts project={project} />
            {isElevated && (
              <button
                className={secondaryBtn}
                onClick={() => setPublishing(true)}
              >
                <L>{"Publish completed-work photo"}</L>{" "}</button>
            )}
          </>
        )}
        {tab === "activity" && <JobActivity id={Number(id)} />}
        {planning && <JobPlan data={d} close={() => setPlanning(false)} />}
        {addingTask && people.data && (
          <TaskDialog
            open
            task={null}

            users={people.data as any}
            isElevated={isElevated}
            defaultProjectId={Number(id)}
            onClose={() => setAddingTask(false)}
          />
        )}
        {publishing && (
          <Publish project={project} onClose={() => setPublishing(false)} />
        )}
      </Suspense>
    </div>
  );
}
function JobPlan({ data, close }: { data: any; close: () => void }) {
  const j = data.job,
    r = data.readiness.rules;
  const [form, set, clear] = useFormDraft(`job-plan:${j.id}`, {
    version: j.version,
    clientId: j.client_id,
    quoteId: j.quote_id || null,
    site: j.site,
    siteAddress: j.site_address || "",
    preferredLanguage: j.preferred_language,
    billingMode: j.billing_mode,
    startDate: j.start_date || "",
    dueDate: j.due_date || "",
    scheduleState: j.schedule_state,
    depositRequired: !!r.deposit_required,
    documentsRequired: JSON.parse(r.documents_required),
    tools: JSON.parse(r.tools),
    overrideReason: "",
  });
  const stale = form.version !== j.version;
  const [reviewedLinks,setReviewedLinks]=useState('');
  const relationshipKey=JSON.stringify([form.clientId,form.quoteId,form.billingMode]);
  const relationshipsChanged=form.clientId!==j.client_id||(form.quoteId||null)!==(j.quote_id||null)||form.billingMode!==j.billing_mode;
  const linksReviewed=!relationshipsChanged||reviewedLinks===relationshipKey;
  const [search, setSearch] = useState("");
  const clients = useSuiteQuery<any[]>(
    ["crm-client-picker", search, form.clientId],
    `/api/suite/pickers/clients?q=${encodeURIComponent(search)}&id=${form.clientId||''}`,
    !j.quote_id,
  );
  const [quoteSearch,setQuoteSearch]=useState('');
  const acceptedQuotes=useSuiteQuery<any[]>(['job-accepted-quotes',j.id,form.clientId,quoteSearch],
    `/api/suite/jobs/${j.id}/accepted-quotes?clientId=${form.clientId||''}&q=${encodeURIComponent(quoteSearch)}`,
    !j.quote_id && !!form.clientId);
  const customerName=clients.data?.find(c=>c.id===form.clientId)?.name || (data.customer?.id===form.clientId?data.customer.name:null);
  const tools = useSuiteQuery<any>(
    ["inventory", "tool-picker"],
    "/api/inventory/items?limit=100&category=tools",
  );
  const save = useApiMutation({
    request: (scheduleState?: 'tentative') => ({
      method: "PATCH",
      url: `/api/suite/jobs/${j.id}`,
      body: {
        ...form,
        quoteId: form.quoteId || null,
        scheduleState: scheduleState || form.scheduleState,
        startDate: form.startDate || null,
        dueDate: form.dueDate || null,
      },
    }),
    errorTitle: "Could not save plan",
    successTitle: "Job plan saved",
    onSuccess: () => {
      clear();
      close();
    },
  });
  const field = (name: string, value: any) => set({ ...form, [name]: value });
  return (
    <Modal preservesDraft open onClose={close} title="Job settings">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if(linksReviewed)save.mutate(undefined);
        }}
      >
        <p className="text-sm text-muted-foreground"><L>{"1. Check customer & billing. 2. Set work dates. 3. Review requirements before confirming. Work status stays separate from this plan."}</L></p>
        {!j.quote_id && (
          <label className="block">
            <L>{"Find customer"}</L>{" "}<input
              name="clientId"
              className={inputCls}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, phone or email"
            />
            {search.length>1&&clients.data?.map((c) => (
              <button
                type="button"
                className="block py-2 underline"
                key={c.id}
                onClick={() => {
                  set({...form,clientId:c.id,quoteId:null});
                  setSearch("");
                }}
              >
                {c.name}
              </button>
            ))}
            <span className="text-sm">
              {form.clientId
                ? customerName || 'Loading customer…'
                : "No customer selected"}
            </span>
          </label>
        )}
        {!j.quote_id && (
          <div className="space-y-2">
            <label className="block"><L>{"Find an accepted quote (optional)"}</L>{" "}<input className={inputCls} value={quoteSearch} onChange={e=>setQuoteSearch(e.target.value)} placeholder="Quote number or customer name" disabled={!form.clientId}/>
            </label>
            <label className="block"><L>{"Link accepted quote"}</L>{" "}<select name="quoteId" className={inputCls} value={form.quoteId||''} disabled={!form.clientId||acceptedQuotes.isLoading} onChange={e=>field('quoteId',e.target.value?Number(e.target.value):null)}>
                <option value=""><L>{"No linked quote"}</L></option>
                {form.quoteId&&!acceptedQuotes.data?.some(q=>q.id===form.quoteId)&&<option value={form.quoteId}><L>{"Previous selection — search to review"}</L></option>}
                {acceptedQuotes.data?.map(q=><option key={q.id} value={q.id}>{q.number} · {q.customerName||customerName} · {formatMoney(q.totalCents)}</option>)}
              </select>
            </label>
            {acceptedQuotes.isError?<p role="alert"><L>{"Could not load quotes."}</L>{" "}<button type="button" className="underline" onClick={()=>acceptedQuotes.refetch()}><L>{"Try again"}</L></button></p>:<p className="text-sm text-muted-foreground">{!form.clientId?'Choose a customer to see their accepted quotes.':acceptedQuotes.data?.length?'Only this customer’s accepted quotes without another linked job are shown.':'No matching quotes available. Accepting a quote normally creates its job automatically. You can save this job without a quote.'}</p>}
          </div>
        )}
        {j.quote_id&&<p className="text-sm"><L>{"Linked quote:"}</L>{" "}<strong>{data.quote?.number||'Previously accepted quote'}</strong>{data.customer?.name&&` · ${data.customer.name}`}</p>}
        <label className="block">
          <L>{"Trade"}</L>{" "}<select
            name="site"
            className={inputCls}
            value={form.site}
            onChange={(e) => field("site", e.target.value)}
          >
            {["metals", "concrete", "insulation", "trades"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <L>{"Job address"}</L>{" "}<input
            name="siteAddress"
            className={inputCls}
            value={form.siteAddress}
            onChange={(e) => field("siteAddress", e.target.value)}
          />
        </label>
        <label className="block">
          <L>{"Billing"}</L>{" "}<select
            name="billingMode"
            className={inputCls}
            value={form.billingMode}
            onChange={(e) => field("billingMode", e.target.value)}
          >
            <option value="review"><L>{"Needs review"}</L></option>
            <option value="fixed"><L>{"Fixed price — costs included in quote"}</L></option>
            <option value="time_materials">
              <L>{"Time & materials — bill recorded work"}</L>{" "}</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          {["startDate", "dueDate"].map((f, i) => (
            <label key={f}>
              {i ? "Finish date" : "Start date"}
              <input
                className={inputCls}
                type="date"
                name={f}
                value={(form as any)[f]}
                onChange={(e) => field(f, e.target.value)}
              />
            </label>
          ))}
        </div>
        <label className="block">
          <L>{"Schedule"}</L>
          <select
            className={inputCls}
            value={form.scheduleState}
            name="scheduleState"
            onChange={(e) => field("scheduleState", e.target.value)}
          >
            <option value="tentative"><L>{"Tentative"}</L></option>
            <option value="confirmed"><L>{"Confirmed"}</L></option>
          </select>
        </label>
        <details>
          <summary className="cursor-pointer py-2">
            <L>{"Readiness requirements & language"}</L>{" "}</summary>
          <div className="space-y-3">
            <label className="block">
              <input
                type="checkbox"
                checked={form.depositRequired}
                onChange={(e) => field("depositRequired", e.target.checked)}
              />{" "}
              <L>{"Require deposit before work"}</L>{" "}</label>
            <label className="block">
              <L>{"Language"}</L>{" "}<select
                name="preferredLanguage"
                className={inputCls}
                value={form.preferredLanguage}
                onChange={(e) => field("preferredLanguage", e.target.value)}
              >
                <option value="en"><L>{"English"}</L></option>
                <option value="es"><L>{"Spanish"}</L></option>
              </select>
            </label>
            {["coi", "w9", "lien_waiver", "contract"].map((k) => (
              <label key={k} className="block">
                <input
                  type="checkbox"
                  checked={form.documentsRequired.includes(k)}
                  onChange={(e) =>
                    field(
                      "documentsRequired",
                      e.target.checked
                        ? [...form.documentsRequired, k]
                        : form.documentsRequired.filter((x: string) => x !== k),
                    )
                  }
                />{" "}
                <L>{"Require"}</L>{" "}{k.replaceAll("_", " ")}
              </label>
            ))}
            <p><L>{"Shared tools needed"}</L></p>
            {tools.data?.items?.map((t: any) => (
              <label className="block" key={t.id}>
                <input
                  type="checkbox"
                  checked={form.tools.includes(t.id)}
                  onChange={(e) =>
                    field(
                      "tools",
                      e.target.checked
                        ? [...form.tools, t.id]
                        : form.tools.filter((v: number) => v !== t.id),
                    )
                  }
                />{" "}
                {t.name}
              </label>
            ))}
          </div>
        </details>
        <details className="rounded-xl border p-3"><summary className="min-h-11 cursor-pointer py-3 font-medium"><L>{"Current readiness ·"}</L>{" "}{data.readiness.ready?'Ready':`${data.readiness.blockers.length} checks need attention`}</summary><p className="mb-2 text-xs text-muted-foreground"><L>{"These are the saved job’s checks before your edits. Dates, crew, payments and requirements are checked again when you save. Work status is changed separately on the job page."}</L></p>{data.readiness.blockers.map((b:any,i:number)=><p key={i} className="border-t py-2 text-sm">{b.label}</p>)}</details>
        {form.scheduleState === "confirmed" && (
          <label className="block">
            <L>{"Reason to confirm despite missing requirements (optional)"}</L>{" "}<textarea
              className={inputCls}
              value={form.overrideReason}
              onChange={(e) => field("overrideReason", e.target.value)}
            />
          </label>
        )}
        {stale && (
          <p role="alert">
            <L>{"This job changed while this draft was open. Your draft is preserved."}</L>{" "}
            <button
              type="button"
              className="underline"
              onClick={() => {
                clear();
                close();
              }}
            >
              <L>{"Discard draft and reopen current settings"}</L>{" "}</button>
          </p>
        )}
        {save.isError&&<p role="alert" className="whitespace-pre-line rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">{save.error.message}</p>}
        {relationshipsChanged&&<section className="space-y-2 rounded-xl border border-amber-400/40 bg-amber-400/5 p-3"><h3 className="font-semibold"><L>{"Review what will change"}</L></h3><p className="text-sm"><L>{"Customer:"}</L>{" "}{customerName||data.customer?.name||'Not selected'}<L>{". Quote:"}</L>{" "}{acceptedQuotes.data?.find(q=>q.id===form.quoteId)?.number||data.quote?.number||(form.quoteId?'Selected accepted quote':'No linked quote')}<L>{". Billing:"}</L>{" "}{form.billingMode==='fixed'?'Fixed price':form.billingMode==='time_materials'?'Time & materials':'Needs review'}.</p><p className="text-xs text-muted-foreground"><L>{"This changes the job’s connections and billing rules. Existing issued quotes, invoices and recorded payments keep their original history. Linking a quote does not accept it."}</L></p><label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={linksReviewed} onChange={e=>setReviewedLinks(e.target.checked?relationshipKey:'')}/><L>{"I reviewed the customer, quote and billing rules."}</L></label></section>}
        {form.scheduleState==='confirmed'&&<p className="text-sm text-muted-foreground"><L>{"Confirming checks dates, crew, deposits, materials, and required paperwork. Save as tentative if you are still arranging these."}</L></p>}
        <div className="suite-modal-actions">{form.scheduleState==='confirmed'&&<button type="button" className={secondaryBtn} disabled={save.isPending||stale||!linksReviewed} onClick={()=>save.mutate('tentative')}><L>{"Save as tentative"}</L></button>}<button className={primaryBtn} disabled={save.isPending || stale||!linksReviewed}>
          <L>{"Save job settings"}</L>
        </button></div>
      </form>
    </Modal>
  );
}
function JobMaterials({ data, owner }: { data: any; owner: boolean }) {
  const id = data.job.id;
  const [ordering, setOrdering] = useState(false);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const reserve = useApiMutation({
    request: () => ({
      method: "POST",
      url: `/api/suite/jobs/${id}/reserve`,
      body: { requestKey },
    }),
    errorTitle: "Could not reserve materials",
    successTitle: "Available materials reserved",
    onSuccess: () => setRequestKey(crypto.randomUUID()),
  });
  return (
    <div className="space-y-5">
      <Card title="Materials & deliveries">
        {owner && (
          <div className="mb-4 flex gap-3">
            <button
              className={secondaryBtn}
              onClick={() => reserve.mutate()}
              disabled={reserve.isPending}
            >
              <L>{"Reserve available stock"}</L>{" "}</button>
            <button className={primaryBtn} onClick={() => setOrdering(true)}>
              <L>{"Order shortages"}</L>{" "}</button>
          </div>
        )}
        {data.readiness.materials.map((m: any) => (
          <div className="border-t py-3" key={m.id}>
            <strong>
              {m.item_id ? (
                <Link className="underline" href={`/item/${m.item_id}`}>
                  {m.label}
                </Link>
              ) : (
                m.label
              )}
            </strong>
            <p className="text-sm">
              <L>{"Needed"}</L>{" "}{m.needed} {" "}<L>{"· Reserved"}</L>{" "}{m.reserved} {" "}<L>{"· Ordered"}</L>{" "}{m.ordered} {" "}<L>{"· Missing"}</L>{" "}{m.missing} {m.unit || "each"}
            </p>
            {!m.item_id && (
              <p className="text-sm text-amber-700">
                <L>{"Link an inventory item in the checklist before ordering."}</L>{" "}</p>
            )}
            {m.orders.map((o: any) =>
              owner ? (
                <Link
                  className="mr-3 text-sm underline"
                  href={`/finance/purchase-orders?po=${o.id}`}
                  key={o.id}
                >
                  {o.number}: {o.expectedDate || "Arrival date needed"}
                </Link>
              ) : (
                <span key={o.id} className="mr-3 text-sm">
                  {o.number}: {o.expectedDate || "Arrival date needed"}
                </span>
              ),
            )}
          </div>
        ))}
      </Card>
      <Checklist projectId={id} />
      {ordering && <JobOrder data={data} close={() => setOrdering(false)} />}
    </div>
  );
}
function JobOrder({ data, close }: { data: any; close: () => void }) {
  const id = data.job.id,
    grouped = new Map<number, any>();
  for (const m of data.readiness.materials)
    if (m.item_id && m.missing > 0) {
      const prev = grouped.get(m.item_id);
      grouped.set(m.item_id, {
        itemId: m.item_id,
        name: m.label,
        quantity: (prev?.quantity || 0) + m.missing,
        unitCostCents: m.last_cost_cents || 0,
      });
    }
  const [form, set, clear] = useFormDraft(`job-order:${id}`, {
    requestKey: crypto.randomUUID(),
    vendor: "",
    expectedDate: "",
    lines: [...grouped.values()],
  });
  const [, navigate] = useLocation();
  const save = useApiMutation({
    request: () => ({
      method: "POST",
      url: `/api/suite/jobs/${id}/order`,
      body: {
        ...form,
        expectedDate: form.expectedDate || null,
        lines: form.lines.filter((l) => l.quantity > 0),
      },
    }),
    errorTitle: "Could not create order",
    successTitle: "Purchase order created",
    onSuccess: (po: any) => {
      clear();
      close();
      navigate(`/finance/purchase-orders?po=${po.id}`);
    },
  });
  return (
    <Modal preservesDraft open title="Order job shortages" onClose={close}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label className="block">
          <L>{"Supplier"}</L>{" "}<input
            required
            className={inputCls}
            value={form.vendor}
            onChange={(e) => set({ ...form, vendor: e.target.value })}
          />
        </label>
        <label className="block">
          <L>{"Expected arrival"}</L>{" "}<input
            type="date"
            className={inputCls}
            value={form.expectedDate}
            onChange={(e) => set({ ...form, expectedDate: e.target.value })}
          />
        </label>
        {form.lines.map((l, i) => (
          <div key={l.itemId} className="space-y-2 border-t py-3">
            <strong>{l.name}</strong>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <L>{"Quantity"}</L>{" "}<input
                  className={inputCls}
                  type="number"
                  min="0"
                  step="any"
                  value={l.quantity}
                  onChange={(e) =>
                    set({
                      ...form,
                      lines: form.lines.map((x, n) =>
                        n === i
                          ? { ...x, quantity: Number(e.target.value) }
                          : x,
                      ),
                    })
                  }
                />
              </label>
              <label>
                <L>{"Cost each ($)"}</L>{" "}<input
                  className={inputCls}
                  type="number"
                  min="0"
                  step="0.01"
                  value={l.unitCostCents / 100}
                  onChange={(e) =>
                    set({
                      ...form,
                      lines: form.lines.map((x, n) =>
                        n === i
                          ? {
                              ...x,
                              unitCostCents: Math.round(
                                Number(e.target.value) * 100,
                              ),
                            }
                          : x,
                      ),
                    })
                  }
                />
              </label>
            </div>
          </div>
        ))}
        {!form.lines.length && <p><L>{"No linked shortages to order."}</L></p>}
        <div className="suite-modal-actions"><button
          className={primaryBtn}
          disabled={save.isPending || !form.lines.length}
        >
          <L>{"Create purchase order"}</L>{" "}</button></div>
      </form>
    </Modal>
  );
}
function JobMoney({ project, actions }: { project: any; actions: any[] }) {
  const q = useSuiteQuery(
      ["project-fin-summary", project.id],
      `/api/finance/projects/${project.id}/summary`,
    ),
    invoices = useSuiteQuery<any[]>(
      ["finance-invoices", "job", project.id],
      `/api/finance/invoices?projectId=${project.id}`,
    );
  if (q.isError) return <RetryBlock query={q} />;
  if (!q.data) return <p><L>{"Loading job money…"}</L></p>;
  const t = q.data.totals;
  return (
    <div className="space-y-5">
      <Card title="Contract to cash"><p className="mb-4 text-sm text-muted-foreground"><L>{"These amounts describe the same job at different stages. Do not add them together. Contract and billed amounts include any recorded tax; drafts are excluded from billing."}</L></p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[
        {label:'Contract + approved changes',amount:t.contractKnown?t.contractCents+t.changeOrderCents:null,note:'Signed contract, or accepted quote, plus approved scope changes.',href:(project.quoteId||project.quote_id)?`/crm/quotes?quote=${project.quoteId||project.quote_id}`:undefined},
        {label:'Billed',amount:t.invoicedCents,note:'Issued invoices, excluding voids and double-counted retainage releases.',href:`/finance/invoices?projectId=${project.id}`},
        {label:'Collected',amount:t.paidCents,note:'Recorded invoice payments after payment reversals.',href:`/finance/invoices?projectId=${project.id}`},
        {label:'Due now',amount:t.dueNowCents,note:'Unpaid billed amount, excluding retainage still held.',href:`/finance/invoices?projectId=${project.id}`},
        {label:'Remaining to bill',amount:t.contractKnown?t.remainingToBillCents:null,note:'Contract and approved changes minus issued invoices. This is not an unpaid invoice.',href:`/finance/invoices?projectId=${project.id}`},
        {label:'Retainage still held',amount:t.retainageHeldCents,note:'Uncollected retainage already included in billed amounts.',href:`/finance/invoices?projectId=${project.id}`},
      ].map(m=><div key={m.label} className="rounded-xl border p-4"><p className="text-sm font-medium">{m.label}</p><p className="my-2 text-xl font-semibold">{m.amount===null?'Not recorded':formatMoney(m.amount)}</p><p className="text-xs text-muted-foreground">{m.note}</p>{m.href&&<Link className="mt-2 inline-flex min-h-11 items-center text-xs underline" href={m.href}><L>{"View source records"}</L></Link>}</div>)}</div>{t.contractKnown&&t.billedAboveContractCents>0&&<p role="status" className="mt-3 text-sm text-amber-700"><L>{"Invoices exceed the recorded contract by"}</L>{" "}{formatMoney(t.billedAboveContractCents)}<L>{". Review approved scope changes and tax treatment."}</L></p>}<p className="mt-3 text-xs text-muted-foreground">{formatMoney(t.draftCents)} {" "}<L>{"in draft invoices is still awaiting review."}</L></p></Card>
      <JobForecast id={project.id} totals={t}/>
      <Card title="Job costs">
        <p className="mb-3">
          <L>{"Billing:"}</L>{" "}
          {project.billing_mode === "fixed"
            ? "Fixed price"
            : project.billing_mode === "time_materials"
              ? "Time & materials"
              : "Needs review"}
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {[
            ["Direct expenses", t.expenseCents],
            ["Stock used", t.stockCostCents],
            ["Labor cost", t.laborCostCents],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-sm text-muted-foreground">{label}</p>
              <strong>{formatMoney(value || 0)}</strong>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground"><L>{"Stock purchases are excluded from direct expenses and counted when consumed, so costs appear once. Missing rates and stock costs need review below."}</L></p>
        {t.missingRateMinutes > 0 && (
          <p role="alert" className="mt-3 text-amber-700">
            <L>{"Labor costs are incomplete: some hours have no dated rate."}</L>{" "}</p>
        )}
        {(t.unknownStockQuantity > 0 ||
          t.historicalMovementsWithoutCost > 0) && (
          <p role="alert" className="mt-3 text-amber-700">
            <L>{"Some stock movements have no verified historical cost. Job margin is incomplete."}</L>{" "}</p>
        )}
        {t.salaryEstimated && (
          <p className="mt-3 text-sm">
            <L>{"Salary allocation is estimated from recorded hours."}</L>{" "}</p>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            className={secondaryBtn}
            href={`/finance/invoices?new=1&projectId=${project.id}&clientId=${project.clientId || ""}`}
          >
            <L>{"New invoice"}</L>
          </Link>
          <Link
            className={secondaryBtn}
            href={`/finance/expenses?new=1&projectId=${project.id}`}
          >
            <L>{"Add expense"}</L>{" "}</Link>
        </div>
      </Card>
      <details className="rounded-xl border p-4"><summary className="min-h-11 cursor-pointer py-2 font-medium"><L>{"Money graphs"}</L></summary><JobMoneyGraphs id={project.id} totals={t}/></details>
      <Card title="Invoices">
        {invoices.isError ? (
          <RetryBlock query={invoices} />
        ) : (
          invoices.data?.map((i) => (
            <Link
              className="block border-t py-3"
              key={i.id}
              href={`/finance/invoices?invoice=${i.id}`}
            >
              {i.number} · {i.status} · {formatMoney(i.totalCents)}
            </Link>
          ))
        )}
      </Card>
      {!!actions.length && (
        <Card title="Billing decisions">
          {actions.map((a) => (
            <ExtraBilling key={a.id} action={a} projectId={project.id} />
          ))}
          <Link className="underline" href="/suite-health">
            <L>{"Review actions"}</L>{" "}</Link>
        </Card>
      )}
      <Changes projectId={project.id} />
    </div>
  );
}
function JobActivity({ id }: { id: number }) {
  const [before, setBefore] = useState<number | null>(null);
  const { isElevated } = useAuth();
  const query = useSuiteQuery<any[]>(
      ["suite-activity", id, before],
      `/api/suite/jobs/${id}/activity${before ? "?before=" + before : ""}`,
    ),
    people = useSuiteQuery<any[]>(["suite-people"], "/api/suite/people");
  const [form, set, clear] = useFormDraft(`job-comment:${id}`, {
    requestKey: crypto.randomUUID(),
    body: "",
    visibility: "team",
    parentId: null as number | null,
    mentions: [] as number[],
    attachments: [] as string[],
  });
  const [uploading, setUploading] = useState(false),
    [error, setError] = useState("");
  const send = useApiMutation({
    request: () => ({
      method: "POST",
      url: `/api/suite/jobs/${id}/comments`,
      body: form,
    }),
    errorTitle: "Could not post comment",
    successTitle: "Comment posted",
    onSuccess: () => {
      clear();
      set({
        requestKey: crypto.randomUUID(),
        body: "",
        visibility: "team",
        parentId: null,
        mentions: [],
        attachments: [],
      });
    },
  });
  return (
    <div className="space-y-5">
      <JobTimeline id={id} />
      <Card title="Internal job conversation">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            send.mutate();
          }}
        >
          {form.parentId && (
            <p>
              <L>{"Replying to comment #"}</L>{form.parentId}{" "}
              <button
                type="button"
                className="underline"
                onClick={() => set({ ...form, parentId: null })}
              >
                <L>{"Cancel reply"}</L>{" "}</button>
            </p>
          )}
          <label className="block">
            <L>{"Comment"}</L>{" "}<textarea
              required
              className={inputCls}
              value={form.body}
              onChange={(e) => set({ ...form, body: e.target.value })}
              placeholder="Update the crew or ask a question…"
            />
          </label>
          <label className="block">
            <L>{"Notify teammate"}</L>{" "}<select
              className={inputCls}
              value=""
              onChange={(e) => {
                if (e.target.value)
                  set({
                    ...form,
                    mentions: [
                      ...new Set([...form.mentions, Number(e.target.value)]),
                    ],
                  });
              }}
            >
              <option value=""><L>{"Choose a teammate"}</L></option>
              {people.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {form.mentions.map((uid) => (
            <button
              type="button"
              key={uid}
              className="mr-2 rounded border px-2 py-1"
              onClick={() =>
                set({
                  ...form,
                  mentions: form.mentions.filter((i) => i !== uid),
                })
              }
            >
              @{people.data?.find((p) => p.id === uid)?.name || uid} ×
            </button>
          ))}
          {isElevated && (
            <label className="block">
              <L>{"Visibility"}</L>{" "}<select
                className={inputCls}
                value={form.visibility}
                onChange={(e) => set({ ...form, visibility: e.target.value })}
              >
                <option value="team"><L>{"Team — internal only"}</L></option>
                <option value="owner"><L>{"Owner only"}</L></option>
              </select>
            </label>
          )}
          <label className="block">
            <L>{"Attach photo"}</L>{" "}<input
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setUploading(true);
                try {
                  const url = await uploadPhoto(file);
                  set({ ...form, attachments: [...form.attachments, url] });
                } catch (e: any) {
                  setError(e.message);
                } finally {
                  setUploading(false);
                }
              }}
            />
          </label>
          {form.attachments.length > 0 && (
            <p>{form.attachments.length} {" "}<L>{"photo(s) attached"}</L></p>
          )}
          {error && <p role="alert">{error}</p>}
          <button className={primaryBtn} disabled={send.isPending || uploading}>
            <L>{"Post internal comment"}</L>{" "}</button>
        </form>
        {query.isError ? (
          <RetryBlock query={query} />
        ) : (
          query.data?.map((c) => (
            <article key={c.id} className="mt-4 border-t pt-4">
              <p className="text-sm text-muted-foreground">
                {c.user_name} · {new Date(c.created_at).toLocaleString()} ·{" "}
                {c.visibility === "owner" ? "Owner only" : "Team"}
                {c.parent_id && ` · Reply to #${c.parent_id}`}
              </p>
              <p className="my-2 whitespace-pre-wrap">{c.body}</p>
              <div className="flex gap-2">
                {c.attachments.map((url: string) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer">
                    <img
                      src={url}
                      className="h-20 w-20 rounded object-cover"
                      loading="lazy"
                      alt="Job attachment"
                    />
                  </a>
                ))}
              </div>
              <button
                className="mt-2 text-sm underline"
                onClick={() =>
                  set({ ...form, parentId: c.id, visibility: c.visibility })
                }
              >
                <L>{"Reply"}</L>{" "}</button>
            </article>
          ))
        )}
        <div className="mt-4 flex gap-4">
          {before && (
            <button className="underline" onClick={() => setBefore(null)}>
              <L>{"Latest comments"}</L>{" "}</button>
          )}
          {query.data?.length === 40 && (
            <button
              className="underline"
              onClick={() => setBefore(query.data!.at(-1).id)}
            >
              <L>{"Older comments"}</L>{" "}</button>
          )}
        </div>
      </Card>
    </div>
  );
}
function JobFiles({ id }: { id: number }) {
  const [downloading,setDownloading]=useState<number|null>(null);
  async function downloadFile(file:{id:number;title:string;url:string}) {
    setDownloading(file.id);setError('');
    try {
      const response=await apiRequest('GET',`/api/suite/jobs/${id}/files/${file.id}/download`);
      const blob=await response.blob(),objectUrl=URL.createObjectURL(blob);
      const link=document.createElement('a');link.href=objectUrl;
      const ext=file.url.split('.').at(-1)||'';
      link.download=file.title.toLowerCase().endsWith('.'+ext)?file.title:file.title+'.'+ext;
      link.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);
    }catch(e:any){setError(e.message);}finally{setDownloading(null);}
  }
  const sources=useSuiteQuery<any[]>(['suite-files','sources',id],`/api/suite/jobs/${id}/source-files`);
  const [kind, setKind] = useState("photo");
  const q = useSuiteQuery<any[]>(
    ["suite-files", id],
    `/api/suite/jobs/${id}/files`,
  );
  const [title, setTitle] = useState(""),
    [url, setUrl] = useState(""),
    [replaces, setReplaces] = useState(""),
    [error, setError] = useState(""),
    [uploading, setUploading] = useState(false);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const add = useApiMutation({
    request: () => ({
      method: "POST",
      url: `/api/suite/jobs/${id}/files`,
      body: {
        requestKey,
        title,
        url,
        kind,
        replacesId: replaces ? Number(replaces) : null,
      },
    }),
    errorTitle: "Could not attach file",
    successTitle: "Job file saved",
    onSuccess: () => {
      setTitle("");
      setUrl("");
      setReplaces("");
      setRequestKey(crypto.randomUUID());
    },
  });
  return (
    <Card title="Photos, drawings & measurements">
      <p className="mb-4 text-sm text-muted-foreground"><L>{"One history of this job’s request, designs and files. Uploads here stay with your team; customer sharing happens in Design Studio."}</L></p>
      {sources.isError?<RetryBlock query={sources}/>:!!sources.data?.length&&<div className="mb-5 grid gap-3 sm:grid-cols-2">{sources.data.map(f=><a key={f.id} href={f.url} className="rounded-xl border p-3 hover:bg-muted" target="_blank" rel="noreferrer">{f.image&&<img src={f.url} alt={f.title} loading="lazy" className="mb-2 aspect-video w-full rounded-lg object-cover"/>}<strong className="text-sm">{f.title}</strong><p className="text-xs text-muted-foreground">{f.source} · {f.visibility}</p></a>)}</div>}
      <DesignRegistry jobId={id}/><JobFileUploader key={id} id={id}/>
      <details className="mb-5"><summary className="min-h-11 cursor-pointer text-sm font-medium"><L>{"Replace a revision or reuse an existing file"}</L></summary>
      <form
        className="mb-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <label className="block">
          <L>{"File title"}</L>{" "}<input
            required
            className={inputCls}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="block">
          <L>{"File type"}</L>{" "}<select
            className={inputCls}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {["photo", "drawing", "measurement", "receipt", "other"].map(
              (k) => (
                <option key={k}>{k}</option>
              ),
            )}
          </select>
        </label>
        <input
          aria-label="Upload job file"
          type="file"
          accept={JOB_FILE_ACCEPT}
          disabled={uploading||add.isPending}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setError('');setUrl('');
            if(f.size>JOB_FILE_MAX_BYTES){setError('Choose a file smaller than 25 MB.');return;}
            setUploading(true);
            try {
              if(isJobImage(f.name))setUrl(await uploadPhoto(f));
              else {
                const body=new FormData();body.append('file',f);
                const token=getAuthToken();
                const response=await fetch(`/api/suite/jobs/${id}/file-upload`,{method:'POST',headers:token?{'X-Auth':token}:{},body});
                const result=await response.json();
                if(!response.ok)throw new Error(result.message||'Upload failed. Try again.');
                setUrl(result.url);
                if(kind==='photo')setKind('other');
              }
              if (!title) setTitle(f.name);
            } catch (e: any) {
              setError(e.message);
            } finally {
              setUploading(false);
            }
          }}
        />
        <p className="text-xs text-muted-foreground"><L>{"Photos, PDF, Word, Excel, CSV, text, CAD drawings, and ZIP · up to 25 MB. Documents keep their original quality."}</L></p>
        {uploading&&<p role="status"><L>{"Uploading file…"}</L></p>}
        <details>
          <summary className="cursor-pointer">
            <L>{"Reuse a file or replace a revision"}</L>{" "}</summary>
          <input
            aria-label="Existing suite file"
            className={inputCls}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="/uploads/…"
          />
          <select
            aria-label="Replaces revision"
            className={inputCls}
            value={replaces}
            onChange={(e) => setReplaces(e.target.value)}
          >
            <option value=""><L>{"New file"}</L></option>
            {q.data?.map((f) => (
              <option value={f.id} key={f.id}>
                {f.title}
              </option>
            ))}
          </select>
        </details>
        {error && <p role="alert">{error}</p>}
        <button
          className={secondaryBtn}
          disabled={!url || uploading || add.isPending}
        >
          <L>{"Save to job"}</L>{" "}</button>
      </form></details>
      {q.isError ? (
        <RetryBlock query={q} />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {q.data?.map((f) => (
            <div className="min-w-0 rounded-xl border p-3" key={f.id}>
              {isJobImage(f.url)&&! /\.hei[cf]$/i.test(f.url)?<a href={f.url} target="_blank" rel="noreferrer"><img
                className="aspect-square w-full rounded object-cover"
                src={f.thumbnail_url || f.url}
                loading="lazy"
                alt={f.title}
              /></a>:<div className="flex aspect-video items-center justify-center rounded bg-muted"><FileText className="h-10 w-10 text-muted-foreground" aria-hidden="true"/><span className="ml-2 text-sm font-medium uppercase">{f.url.split('.').at(-1)}</span></div>}
              <p className="mt-2 break-words font-medium">{f.title}</p>
              <p className="text-xs text-muted-foreground">
                {q.data.some((n) => n.replaces_id === f.id)
                  ? "Older revision"
                  : "Current"}{" "}
                <L>{"· Team only ·"}</L>{" "}{f.user_name}
              </p>
              <button type="button" className={`${secondaryBtn} mt-3`} aria-label={`Download ${f.title}`} disabled={downloading===f.id} onClick={()=>downloadFile(f)}><Download className="h-4 w-4" aria-hidden="true"/>{downloading===f.id?'Downloading…':'Download'}</button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function JobTimeline({ id }: { id: number }) {
  const [before, setBefore] = useState<number | null>(null);
  const q = useSuiteQuery<any[]>(
    ["suite-timeline", id, before],
    `/api/suite/jobs/${id}/timeline${before ? "?before=" + before : ""}`,
  );
  return (
    <Card title="Job activity">
      {q.isError ? (
        <RetryBlock query={q} />
      ) : (
        q.data?.map((e) => (
          <p className="border-t py-3 text-sm" key={e.id}>
            {e.action.split(".").at(-1).replaceAll("_", " ")} · {e.target_name}{" "}
            · {e.user_name} · {new Date(e.created_at).toLocaleString()}
          </p>
        ))
      )}
      <div className="flex gap-4">
        {before && (
          <button className="underline" onClick={() => setBefore(null)}>
            <L>{"Latest activity"}</L>{" "}</button>
        )}
        {q.data?.length === 40 && (
          <button
            className="underline"
            onClick={() => setBefore(q.data!.at(-1).id)}
          >
            <L>{"Older activity"}</L>{" "}</button>
        )}
      </div>
    </Card>
  );
}
