import { ExtraBilling } from "./suite-reviews";
import { useSuiteQuery } from "@/lib/suite-query";
import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useDeepLink } from "@/lib/deep-link";
import { useFormDraft } from "@/lib/form-draft";
import { useApiMutation } from "@/hooks/useApiMutation";
import { inputCls, primaryBtn, secondaryBtn } from "@/lib/ui-styles";
import { shrinkAndUpload as uploadPhoto } from "@/lib/uploadPhoto";
import { formatMoney } from "@/lib/format";
import { RetryBlock } from "@/components/RetryBlock";
import Modal from "@/components/Modal";
import Header from "@/components/Header";
const Checklist = lazy(() => import("@/components/ProjectChecklist"));
const Documents = lazy(() => import("@/components/DocumentsCard"));
const Contracts = lazy(() =>
  import("./project-detail").then((m) => ({ default: m.ContractsCard })),
);
const Changes = lazy(() =>
  import("./project-detail").then((m) => ({ default: m.ChangeOrdersCard })),
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
  const [, navigate] = useLocation();
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
  if (!query.data) return <p role="status">Loading job…</p>;
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
        ← Jobs
      </Link>
      <Header
        title={j.name}
        description={`${j.job_number} · ${j.site} · ${j.status.replace("_", " ")}`}
      />
      <div className="flex flex-wrap gap-2">
        <button
          className={primaryBtn}
          onClick={() => start.mutate()}
          disabled={start.isPending}
        >
          Start work
        </button>
        {isElevated && (
          <>
            <button className={secondaryBtn} onClick={() => setPlanning(true)}>
              Job settings
            </button>
            <select
              aria-label="Job status"
              className="h-11 rounded-lg border bg-background px-3"
              value={j.status}
              onChange={(e) => status.mutate(e.target.value)}
              disabled={status.isPending}
            >
              <option value="active">Active</option>
              <option value="on_hold">On hold</option>
              <option value="done">Completed</option>
            </select>
          </>
        )}
      </div>
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
      <Suspense fallback={<p role="status">Loading section…</p>}>
        {tab === "overview" && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Next actions">
              {d.readiness.ready ? (
                <p>Ready for the planned work.</p>
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
                  Date confirmed with exception: {d.readiness.override.reason}
                </p>
              )}
              {j.status === "done" && (
                <p className="mt-3">
                  Review final billing, unused materials, tools and
                  completed-work photos.
                </p>
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
                <p>Customer link needs review.</p>
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
                  Open {d.quote.number} · {d.quote.status}
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
                  Add task
                </button>
                <Link
                  className={secondaryBtn}
                  href={`/pm/time?projectId=${id}`}
                >
                  Time entries
                </Link>
                <Link className={secondaryBtn} href="/pm/schedule">
                  Crew calendar
                </Link>
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
                <p>No open tasks.</p>
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
            <JobFiles id={Number(id)} />
            <Documents projectId={Number(id)} />
            <Contracts project={project} />
            {isElevated && (
              <button
                className={secondaryBtn}
                onClick={() => setPublishing(true)}
              >
                Publish completed-work photo
              </button>
            )}
          </>
        )}
        {tab === "activity" && <JobActivity id={Number(id)} />}
        {planning && <JobPlan data={d} close={() => setPlanning(false)} />}
        {addingTask && people.data && (
          <TaskDialog
            open
            task={null}
            projects={[project]}
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
    quoteId: j.quote_id,
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
  const [search, setSearch] = useState("");
  const clients = useSuiteQuery<any[]>(
    ["crm-client-picker", search],
    `/api/crm/clients?q=${encodeURIComponent(search)}&limit=12`,
    search.length > 1,
  );
  const tools = useSuiteQuery<any>(
    ["inventory", "tool-picker"],
    "/api/inventory/items?limit=100&category=tools",
  );
  const save = useApiMutation({
    request: () => ({
      method: "PATCH",
      url: `/api/suite/jobs/${j.id}`,
      body: {
        ...form,
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
          save.mutate();
        }}
      >
        {!j.quote_id && (
          <label className="block">
            Find customer
            <input
              className={inputCls}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, phone or email"
            />
            {clients.data?.map((c) => (
              <button
                type="button"
                className="block py-2 underline"
                key={c.id}
                onClick={() => {
                  field("clientId", c.id);
                  setSearch("");
                }}
              >
                {c.name}
              </button>
            ))}
            <span className="text-sm">
              {form.clientId
                ? `Customer #${form.clientId}`
                : "No customer selected"}
            </span>
          </label>
        )}
        {!j.quote_id && (
          <label className="block">
            Accepted quote ID (optional)
            <input
              className={inputCls}
              type="number"
              min="1"
              value={form.quoteId || ""}
              onChange={(e) =>
                field("quoteId", e.target.value ? Number(e.target.value) : null)
              }
            />
            <span className="text-sm">
              Use this only after reviewing the accepted quote and customer.
            </span>
          </label>
        )}
        <label className="block">
          Trade
          <select
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
          Job address
          <input
            className={inputCls}
            value={form.siteAddress}
            onChange={(e) => field("siteAddress", e.target.value)}
          />
        </label>
        <label className="block">
          Billing
          <select
            className={inputCls}
            value={form.billingMode}
            onChange={(e) => field("billingMode", e.target.value)}
          >
            <option value="review">Needs review</option>
            <option value="fixed">Fixed price — costs included in quote</option>
            <option value="time_materials">
              Time & materials — bill recorded work
            </option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          {["startDate", "dueDate"].map((f, i) => (
            <label key={f}>
              {i ? "Finish date" : "Start date"}
              <input
                className={inputCls}
                type="date"
                value={(form as any)[f]}
                onChange={(e) => field(f, e.target.value)}
              />
            </label>
          ))}
        </div>
        <label className="block">
          Schedule
          <select
            className={inputCls}
            value={form.scheduleState}
            onChange={(e) => field("scheduleState", e.target.value)}
          >
            <option value="tentative">Tentative</option>
            <option value="confirmed">Confirmed</option>
          </select>
        </label>
        <details>
          <summary className="cursor-pointer py-2">
            Readiness requirements & language
          </summary>
          <div className="space-y-3">
            <label className="block">
              <input
                type="checkbox"
                checked={form.depositRequired}
                onChange={(e) => field("depositRequired", e.target.checked)}
              />{" "}
              Require deposit before work
            </label>
            <label className="block">
              Language
              <select
                className={inputCls}
                value={form.preferredLanguage}
                onChange={(e) => field("preferredLanguage", e.target.value)}
              >
                <option value="en">English</option>
                <option value="es">Spanish</option>
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
                Require {k.replaceAll("_", " ")}
              </label>
            ))}
            <p>Shared tools needed</p>
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
        {form.scheduleState === "confirmed" && (
          <label className="block">
            Exception reason, if confirming despite warnings
            <textarea
              className={inputCls}
              value={form.overrideReason}
              onChange={(e) => field("overrideReason", e.target.value)}
            />
          </label>
        )}
        {stale && (
          <p role="alert">
            This job changed while this draft was open. Your draft is preserved.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => {
                clear();
                close();
              }}
            >
              Discard draft and reopen current settings
            </button>
          </p>
        )}
        <button className={primaryBtn} disabled={save.isPending || stale}>
          Save job settings
        </button>
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
              Reserve available stock
            </button>
            <button className={primaryBtn} onClick={() => setOrdering(true)}>
              Order shortages
            </button>
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
              Needed {m.needed} · Reserved {m.reserved} · Ordered {m.ordered} ·
              Missing {m.missing} {m.unit || "each"}
            </p>
            {!m.item_id && (
              <p className="text-sm text-amber-700">
                Link an inventory item in the checklist before ordering.
              </p>
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
          Supplier
          <input
            required
            className={inputCls}
            value={form.vendor}
            onChange={(e) => set({ ...form, vendor: e.target.value })}
          />
        </label>
        <label className="block">
          Expected arrival
          <input
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
                Quantity
                <input
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
                Cost each ($)
                <input
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
        {!form.lines.length && <p>No linked shortages to order.</p>}
        <button
          className={primaryBtn}
          disabled={save.isPending || !form.lines.length}
        >
          Create purchase order
        </button>
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
  if (!q.data) return <p>Loading job money…</p>;
  const t = q.data.totals;
  return (
    <div className="space-y-5">
      <Card title="Job money">
        <p className="mb-3">
          Billing:{" "}
          {project.billing_mode === "fixed"
            ? "Fixed price"
            : project.billing_mode === "time_materials"
              ? "Time & materials"
              : "Needs review"}
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {[
            ["Draft invoices", t.draftCents],
            ["Billed", t.invoicedCents],
            ["Collected", t.paidCents],
            ["Outstanding", t.outstandingCents],
            ["Direct expenses", t.expenseCents],
            ["Stock used", t.stockCostCents],
            ["Labor cost", t.laborCostCents],
            ["Quoted + extras", t.contractCents + t.changeOrderCents],
            ["Retained", t.retainageHeldCents],
            ["Due now", t.dueNowCents],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-sm text-muted-foreground">{label}</p>
              <strong>{formatMoney(value || 0)}</strong>
            </div>
          ))}
        </div>
        {t.missingRateMinutes > 0 && (
          <p role="alert" className="mt-3 text-amber-700">
            Labor costs are incomplete: some hours have no dated rate.
          </p>
        )}
        {(t.unknownStockQuantity > 0 ||
          t.historicalMovementsWithoutCost > 0) && (
          <p role="alert" className="mt-3 text-amber-700">
            Some stock movements have no verified historical cost. Job margin is
            incomplete.
          </p>
        )}
        {t.salaryEstimated && (
          <p className="mt-3 text-sm">
            Salary allocation is estimated from recorded hours.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            className={secondaryBtn}
            href={`/finance/invoices?new=1&projectId=${project.id}&clientId=${project.clientId || ""}`}
          >
            New invoice
          </Link>
          <Link
            className={secondaryBtn}
            href={`/finance/expenses?new=1&projectId=${project.id}`}
          >
            Add expense
          </Link>
        </div>
      </Card>
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
            Review actions
          </Link>
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
              Replying to comment #{form.parentId}{" "}
              <button
                type="button"
                className="underline"
                onClick={() => set({ ...form, parentId: null })}
              >
                Cancel reply
              </button>
            </p>
          )}
          <label className="block">
            Comment
            <textarea
              required
              className={inputCls}
              value={form.body}
              onChange={(e) => set({ ...form, body: e.target.value })}
              placeholder="Update the crew or ask a question…"
            />
          </label>
          <label className="block">
            Notify teammate
            <select
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
              <option value="">Choose a teammate</option>
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
              Visibility
              <select
                className={inputCls}
                value={form.visibility}
                onChange={(e) => set({ ...form, visibility: e.target.value })}
              >
                <option value="team">Team — internal only</option>
                <option value="owner">Owner only</option>
              </select>
            </label>
          )}
          <label className="block">
            Attach photo
            <input
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
            <p>{form.attachments.length} photo(s) attached</p>
          )}
          {error && <p role="alert">{error}</p>}
          <button className={primaryBtn} disabled={send.isPending || uploading}>
            Post internal comment
          </button>
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
                Reply
              </button>
            </article>
          ))
        )}
        <div className="mt-4 flex gap-4">
          {before && (
            <button className="underline" onClick={() => setBefore(null)}>
              Latest comments
            </button>
          )}
          {query.data?.length === 40 && (
            <button
              className="underline"
              onClick={() => setBefore(query.data!.at(-1).id)}
            >
              Older comments
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
function JobFiles({ id }: { id: number }) {
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
      <form
        className="mb-5 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <label className="block">
          File title
          <input
            required
            className={inputCls}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="block">
          File type
          <select
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
          aria-label="Upload job image"
          type="file"
          accept="image/*"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setUploading(true);
            try {
              setUrl(await uploadPhoto(f));
              if (!title) setTitle(f.name);
            } catch (e: any) {
              setError(e.message);
            } finally {
              setUploading(false);
            }
          }}
        />
        <details>
          <summary className="cursor-pointer">
            Reuse a suite photo or replace a revision
          </summary>
          <input
            aria-label="Existing suite photo"
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
            <option value="">New file</option>
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
          Save to job
        </button>
      </form>
      {q.isError ? (
        <RetryBlock query={q} />
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {q.data?.map((f) => (
            <a href={f.url} target="_blank" rel="noreferrer" key={f.id}>
              <img
                className="aspect-square w-full rounded object-cover"
                src={f.thumbnail_url || f.url}
                loading="lazy"
                alt={f.title}
              />
              <p>{f.title}</p>
              <p className="text-xs text-muted-foreground">
                {q.data.some((n) => n.replaces_id === f.id)
                  ? "Older revision"
                  : "Current"}{" "}
                · {f.user_name}
              </p>
            </a>
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
            Latest activity
          </button>
        )}
        {q.data?.length === 40 && (
          <button
            className="underline"
            onClick={() => setBefore(q.data!.at(-1).id)}
          >
            Older activity
          </button>
        )}
      </div>
    </Card>
  );
}
