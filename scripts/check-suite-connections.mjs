import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { testApp } from "./test-app.mjs";
const app = await testApp();
const { api, owner, sqlite } = app;
const key = () => crypto.randomUUID();
async function call(url, method = "GET", body, token = owner) {
  const r = await api(url, method, body, token);
  assert.ok(
    [200, 201].includes(r.status),
    `${url}: ${r.status} ${JSON.stringify(r.data)}`,
  );
  return r.data;
}
const createJob = (site) =>
  call("/api/projects", "POST", {
    jobNumber: `SUITE-${site}`,
    name: `Synthetic ${site} job`,
  });
try {
  const user = await call("/api/users", "POST", {
      name: "Suite Worker",
      pin: "1234",
      role: "worker",
    }),
    worker = (
      await call("/api/auth/login", "POST", {
        name: "Suite Worker",
        pin: "1234",
      })
    ).token;
  const jobs = [];
  for (const site of ["metals", "concrete", "insulation"]) {
    const j = await createJob(site);
    jobs.push(j);
    const d = await call(`/api/suite/jobs/${j.id}`);
    await call(`/api/suite/jobs/${j.id}`, "PATCH", {
      version: d.job.version,
      clientId: null,
      site,
      siteAddress: "Synthetic test location",
      preferredLanguage: site === "concrete" ? "es" : "en",
      billingMode: "fixed",
      startDate: "2026-09-14",
      dueDate: "2026-09-15",
      scheduleState: "tentative",
      depositRequired: false,
      documentsRequired: [],
      tools: [],
    });
    assert.equal((await call(`/api/suite/jobs/${j.id}`)).job.site, site);
  }
  const job = jobs[0];
  const task = await call("/api/pm/tasks", "POST", {
    title: "Synthetic crew task",
    projectId: job.id,
    assigneeId: user.id,
    startDate: "2026-09-14",
    dueDate: "2026-09-15",
  });
  assert.equal(
    (
      await api(
        "/api/pm/time/start",
        "POST",
        { projectId: jobs[1].id, taskId: task.id },
        worker,
      )
    ).status,
    400,
  );
  await call("/api/pm/time/start", "POST", { taskId: task.id }, worker);
  assert.equal(
    (await call("/api/pm/time/running", "GET", undefined, worker)).projectId,
    job.id,
  );
  await call("/api/pm/time/stop", "POST", undefined, worker);
  assert.ok(
    (await call("/api/suite/notifications", "GET", undefined, worker)).some(
      (n) => n.title.includes("Synthetic crew"),
    ),
  );
  const comment = {
    requestKey: key(),
    body: "Review this measurement",
    visibility: "team",
    mentions: [user.id],
    attachments: [],
  };
  await call(`/api/suite/jobs/${job.id}/comments`, "POST", comment);
  await call(`/api/suite/jobs/${job.id}/comments`, "POST", comment);
  await call(`/api/suite/jobs/${job.id}/comments`, "POST", {
    ...comment,
    requestKey: key(),
    body: "Private owner note",
    visibility: "owner",
    mentions: [],
  });
  const workerComments = await call(
    `/api/suite/jobs/${job.id}/activity`,
    "GET",
    undefined,
    worker,
  );
  assert.equal(workerComments.length, 1);
  assert.equal(
    (await api("/api/suite/health", "GET", undefined, worker)).status,
    403,
  );
  assert.equal(
    (
      await api(
        `/api/suite/jobs/${job.id}/comments`,
        "POST",
        { ...comment, requestKey: key(), visibility: "owner" },
        worker,
      )
    ).status,
    403,
  );
  const before = await api(`/api/pm/tasks/${task.id}`, "GET", undefined, owner);
  assert.ok(before.headers.get("etag"));
  await call(`/api/pm/tasks/${task.id}`, "PATCH", {
    title: "Task changed elsewhere",
  });
  assert.equal(
    (
      await api(
        `/api/pm/tasks/${task.id}`,
        "PATCH",
        { title: "Stale overwrite" },
        owner,
        { "If-Match": before.headers.get("etag") },
      )
    ).status,
    409,
  );
  console.log(
    "PASS three trades, task/job consistency, global timer, mentions, privacy and version conflicts",
  );

  // Dated costs include corrections and retain history for a deleted employee.
  const emp = await call("/api/hr/employees", "POST", {
    firstName: "Suite",
    lastName: "Worker",
    userId: user.id,
    payType: "hourly",
    payRateCents: 2500,
    hireDate: "2026-01-01",
  });
  sqlite
    .prepare(
      "INSERT INTO hr_pay_rates(employee_id,effective_date,pay_type,rate_cents,created_at) VALUES(?,'2026-07-10','hourly',3500,?)",
    )
    .run(emp.id, Date.now());
  const start = Date.parse("2026-07-09T23:00:00-05:00");
  const entry = await call(
    "/api/pm/time",
    "POST",
    { projectId: job.id, startedAt: start, endedAt: start + 2 * 3600000 },
    worker,
  );
  sqlite
    .prepare(
      "INSERT INTO hr_time_corrections(time_entry_id,user_id,minutes_delta,effective_date,rate_cents,reason,created_by,created_at) VALUES(?,?,30,'2026-09-10',2500,'Synthetic correction',1,?)",
    )
    .run(entry.id, user.id, Date.now());
  sqlite
    .prepare("UPDATE hr_employees SET deleted_at=? WHERE id=?")
    .run(Date.now(), emp.id);
  const { projectLabor } = await import("../server/labor-cost.ts");
  assert.equal(projectLabor(job.id).costCents, 7250);
  const inv = await call("/api/finance/invoices", "POST", {
    projectId: job.id,
    items: "[]",
  });
  assert.equal(
    (
      await api(
        `/api/finance/invoices/${inv.id}/pull-unbilled`,
        "POST",
        { projectId: job.id },
        owner,
      )
    ).status,
    409,
  );
  sqlite
    .prepare("UPDATE projects SET billing_mode='time_materials' WHERE id=?")
    .run(job.id);
  await call(`/api/finance/invoices/${inv.id}/pull-unbilled`, "POST", {
    projectId: job.id,
  });
  assert.equal(projectLabor(job.id, true).groups.length, 0);
  await call(`/api/finance/invoices/${inv.id}`, "PATCH", { status: "void" });
  assert.equal(projectLabor(job.id, true).costCents, 7250);
  console.log(
    "PASS historical rates across midnight, payroll correction allocation, fixed-price billing guard and void release",
  );

  const item = await call("/api/items", "POST", {
    name: "Synthetic tube",
    category: "raw_materials",
    itemType: "raw_material",
    unit: "ft",
    quantity: 0,
    materialKey: "tube_2x2",
  });
  sqlite
    .prepare(
      "INSERT INTO project_checklist(project_id,label,item_id,qty,unit) VALUES(?,'Tube',?,10,'ft')",
    )
    .run(job.id, item.id);
  const order = await call(`/api/suite/jobs/${job.id}/order`, "POST", {
    requestKey: key(),
    vendor: "Test supplier",
    expectedDate: "2026-09-14",
    lines: [{ itemId: item.id, quantity: 10, unitCostCents: 200 }],
  });
  const { receivePo } = await import("../server/inventory-receiving.ts");
  const delivery = {
    requestKey: key(),
    lines: [{ lineIndex: 0, quantity: 4, itemId: item.id, stockQuantity: 4 }],
  };
  receivePo(order.id, 1, delivery);
  receivePo(order.id, 1, delivery);
  let d = await call(`/api/suite/jobs/${job.id}`);
  assert.equal(d.readiness.materials[0].ordered, 6);
  assert.equal(d.readiness.materials[0].reserved, 0);
  await call(`/api/suite/jobs/${job.id}/reserve`, "POST", {
    requestKey: key(),
  });
  d = await call(`/api/suite/jobs/${job.id}`);
  assert.equal(d.readiness.materials[0].reserved, 4);
  assert.equal(d.readiness.materials[0].missing, 0);
  await call(`/api/items/${item.id}/checkout`, "POST", {
    projectId: job.id,
    quantity: 3,
    requestKey: key(),
  });
  const money = await call(`/api/finance/projects/${job.id}/summary`);
  assert.equal(money.totals.stockCostCents, 600);
  assert.equal(money.totals.expenseCents, 0);
  await call(`/api/items/${item.id}/checkin`, "POST", {
    projectId: job.id,
    quantity: 1,
    requestKey: key(),
  });
  assert.equal(
    (await call(`/api/finance/projects/${job.id}/summary`)).totals
      .stockCostCents,
    400,
  );
  assert.equal((await call("/api/suite/costs")).length, 1);
  console.log(
    "PASS shortage ordering, idempotent partial receipt, explicit reservation, FIFO usage/return and no double cost",
  );

  const co = await call("/api/pm/change-orders", "POST", {
    projectId: job.id,
    title: "Approved synthetic extra",
    status: "approved",
    amountCents: 5000,
  });
  const extra = await call(`/api/suite/change-orders/${co.id}/bill`, "POST", {
    requestKey: key(),
    reviewed: true,
  });
  assert.equal(
    (
      await call(`/api/suite/change-orders/${co.id}/bill`, "POST", {
        requestKey: key(),
        reviewed: true,
      })
    ).id,
    extra.id,
  );
  const c1 = await call("/api/crm/clients", "POST", {
      name: "Retained customer",
      email: "duplicate@example.test",
    }),
    c2 = await call("/api/crm/clients", "POST", {
      name: "Duplicate customer",
      email: "duplicate@example.test",
    });
  sqlite
    .prepare("UPDATE projects SET client_id=? WHERE id=?")
    .run(c2.id, job.id);
  const preview = await call(
    `/api/suite/customer-merge?source=${c2.id}&target=${c1.id}`,
  );
  await call("/api/suite/customer-merge", "POST", {
    requestKey: key(),
    source: c2.id,
    target: c1.id,
    version: preview.version,
    reason: "Confirmed synthetic duplicate",
  });
  assert.equal((await call(`/api/suite/jobs/${job.id}`)).job.client_id, c1.id);
  await call("/api/suite/health");
  for (const url of [
    "/api/crm/clients",
    "/api/crm/leads",
    "/api/finance/invoices",
    "/api/finance/expenses",
  ])
    assert.ok(
      (await api(`${url}?page=0&limit=1`, "GET", undefined, owner)).headers.get(
        "x-total-count",
      ),
    );
  const search = await call("/api/search?q=Synthetic&all=1");
  assert.deepEqual(search.unavailable, []);
  console.log(
    "PASS reviewed extra billing once, duplicate merge, owner health, paginated totals and all search sources",
  );

  // A real authenticated stream carries only topic revisions and stops on logout.
  const abort = new AbortController();
  const stream = await fetch(app.base + "/api/suite/events", {
    headers: { "X-Auth": worker },
    signal: abort.signal,
  });
  const reader = stream.body.getReader();
  try {
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.ok(first.includes("inventory"));
    assert.ok(!first.includes('"finance"'));
    sqlite
      .prepare("UPDATE projects SET name=? WHERE id=?")
      .run("Synthetic live change", job.id);
    const next = await Promise.race([
      reader.read(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("No live update")), 6000),
      ),
    ]);
    assert.ok(new TextDecoder().decode(next.value).includes("data:"));
  } finally {
    abort.abort();
    await reader.cancel().catch(() => {});
  }
  console.log("PASS authenticated live revisions without owner-only topics");

  // Provider mock: fail first, retry identical payload, then suppress duplicates.
  const { sendMail } = await import("../server/mailer.ts");
  const { runSuiteFollowups } = await import("../server/suite-worker.ts");
  const originalFetch = globalThis.fetch;
  const sent = [];
  process.env.RESEND_API_KEY = "synthetic";
  process.env.MAIL_FROM = "test@example.test";
  let failure = true;
  globalThis.fetch = async (url, init) => {
    if (String(url) === "https://api.resend.com/emails") {
      if (failure) {
        failure = false;
        throw new Error("Synthetic transport interruption");
      }
      sent.push({ body: init.body, key: init.headers["Idempotency-Key"] });
      return new Response(JSON.stringify({ id: "synthetic-accepted" }), {
        status: 200,
      });
    }
    return originalFetch(url, init);
  };
  try {
    assert.equal(
      await sendMail({
        to: "owner@example.test",
        subject: "Synthetic durable send",
        text: "test",
        deliveryKey: "suite-test-mail",
      }),
      false,
    );
    sqlite
      .prepare(
        "UPDATE suite_outbox SET available_at=0 WHERE event_key='delivery:suite-test-mail'",
      )
      .run();
    await runSuiteFollowups();
    await runSuiteFollowups();
    assert.equal(
      await sendMail({
        to: "changed@example.test",
        subject: "Must keep original",
        text: "changed",
        deliveryKey: "suite-test-mail",
      }),
      true,
    );
    assert.equal(sent.filter((s) => s.key === "suite-test-mail").length, 1);
    assert.equal(
      JSON.parse(sent.find((s) => s.key === "suite-test-mail").body).to,
      "owner@example.test",
    );
  } finally {
    globalThis.fetch = originalFetch;
    process.env.RESEND_API_KEY = "";
    process.env.MAIL_FROM = "";
  }
  console.log(
    "PASS durable delivery, frozen payload, retries and duplicate suppression",
  );
  const clientKey = key(),
    cb = { name: "Retry-safe customer" };
  const first = await api("/api/crm/clients", "POST", cb, owner, {
    "Idempotency-Key": clientKey,
  });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const repeated = await api("/api/crm/clients", "POST", cb, owner, {
    "Idempotency-Key": clientKey,
  });
  assert.equal(repeated.data.id, first.data.id);
  assert.equal(
    sqlite
      .prepare(
        "SELECT count(*) n FROM crm_clients WHERE name='Retry-safe customer'",
      )
      .get().n,
    1,
  );
  assert.equal(
    (
      await api("/api/crm/clients", "POST", { name: "Different" }, owner, {
        "Idempotency-Key": clientKey,
      })
    ).status,
    400,
  );
  const badKey = key();
  assert.equal(
    (
      await api("/api/crm/clients", "POST", {}, owner, {
        "Idempotency-Key": badKey,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api(
        "/api/crm/clients",
        "POST",
        { name: "Valid after invalid" },
        owner,
        { "Idempotency-Key": badKey },
      )
    ).status,
    201,
  );
  const linked = await call("/api/projects", "POST", {
    name: "Customer linked job",
    jobNumber: "ID-SAFE",
    clientId: first.data.id,
  });
  assert.equal(
    (
      await api(
        "/api/finance/invoices",
        "POST",
        { projectId: linked.id, items: "[]" },
        owner,
      )
    ).status,
    400,
  );
  const bill = await call("/api/finance/invoices", "POST", {
    projectId: linked.id,
    clientId: first.data.id,
    items: JSON.stringify([
      { description: "Work", qty: 1, unitPriceCents: 50000 },
    ]),
  });
  const payKey = key(),
    pay = { amountCents: 5000, method: "cash" };
  const paid1 = await api(
    `/api/finance/invoices/${bill.id}/payments`,
    "POST",
    pay,
    owner,
    { "Idempotency-Key": payKey },
  );
  assert.equal(paid1.status, 201, JSON.stringify(paid1.data));
  const paid2 = await api(
    `/api/finance/invoices/${bill.id}/payments`,
    "POST",
    pay,
    owner,
    { "Idempotency-Key": payKey },
  );
  assert.equal(paid2.data.payment.id, paid1.data.payment.id);
  assert.equal(
    sqlite
      .prepare("SELECT paid_cents FROM fin_invoices WHERE id=?")
      .get(bill.id).paid_cents,
    5000,
  );
  assert.equal(
    (
      await api(
        `/api/finance/invoices/${bill.id}`,
        "PATCH",
        { clientId: null },
        owner,
      )
    ).status,
    400,
  );
  assert.ok(
    (await call(`/api/suite/jobs/${job.id}/timeline`)).some(
      (e) => e.action === "pm.task_create",
    ),
  );

  const stockDraft = await call("/api/finance/invoices", "POST", {
    projectId: job.id,
    clientId: sqlite
      .prepare("SELECT client_id FROM projects WHERE id=?")
      .get(job.id).client_id,
    items: "[]",
  });
  await call(`/api/finance/invoices/${stockDraft.id}/pull-unbilled`, "POST", {
    projectId: job.id,
  });
  assert.equal(
    sqlite
      .prepare(
        "SELECT count(*) n FROM suite_stock_costs WHERE project_id=? AND invoice_id IS NULL",
      )
      .get(job.id).n,
    0,
  );
  assert.equal(
    (
      await api(
        `/api/finance/invoices/${stockDraft.id}`,
        "PATCH",
        { items: "[]" },
        owner,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await api(
        `/api/pm/change-orders/${co.id}`,
        "PATCH",
        { status: "void" },
        owner,
      )
    ).status,
    409,
  );
  await call(`/api/finance/invoices/${stockDraft.id}`, "PATCH", {
    status: "void",
  });
  assert.ok(
    sqlite
      .prepare(
        "SELECT count(*) n FROM suite_stock_costs WHERE project_id=? AND invoice_id IS NULL",
      )
      .get(job.id).n > 0,
  );
  console.log(
    "PASS retry-safe customer/payment saves, request mismatch rejection, customer/job guards and unified timeline",
  );
} finally {
  await app.close();
}
